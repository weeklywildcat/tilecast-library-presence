use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub const SOURCE_URL: &str = "https://signage.weeklywildcat.com/library/presence.json";
pub const SOURCE_MAX_BYTES: usize = 8192;
pub const VALIDITY_MS: i64 = 75_000;
const REFRESH_MS: i64 = 30_000;
const GREETING_MS: i64 = 7000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Position {
    TopLeft,
    TopRight,
    #[default]
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Configuration {
    pub personalized_greetings: bool,
    pub position: Position,
}
impl Default for Configuration {
    fn default() -> Self {
        Self {
            personalized_greetings: true,
            position: Position::BottomLeft,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    schema_version: u32,
    current_count: u32,
    generated_at: String,
    latest_check_in: Option<CheckIn>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckIn {
    cursor: String,
    at: String,
    first_name: Option<String>,
}
pub struct Observation {
    pub count: u32,
    pub check_in: Option<Arrival>,
}
pub struct Arrival {
    cursor: String,
    at_ms: i64,
    first_name: Option<String>,
}

fn timestamp(value: &str) -> Result<i64, &'static str> {
    if value.len() > 40 {
        return Err("invalid_timestamp");
    }
    let parsed = OffsetDateTime::parse(value, &Rfc3339).map_err(|_| "invalid_timestamp")?;
    i64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).map_err(|_| "invalid_timestamp")
}
pub fn iso(ms: i64) -> Result<String, &'static str> {
    OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000)
        .map_err(|_| "invalid_timestamp")?
        .format(&Rfc3339)
        .map_err(|_| "invalid_timestamp")
}
fn safe_text(value: &str, max_chars: usize, max_bytes: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= max_bytes
        && value.chars().count() <= max_chars
        && !value.chars().any(|c| {
            c.is_control() || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
}
pub fn parse_source(raw: &[u8], now: i64) -> Result<Observation, &'static str> {
    if raw.len() > SOURCE_MAX_BYTES {
        return Err("source_too_large");
    }
    let source: Source = serde_json::from_slice(raw).map_err(|_| "invalid_source")?;
    if source.schema_version != 1 || source.current_count > 100_000 {
        return Err("invalid_source");
    }
    let generated = timestamp(&source.generated_at)?;
    if generated < now.saturating_sub(30_000) || generated > now.saturating_add(5000) {
        return Err("stale_source");
    }
    let check_in = source
        .latest_check_in
        .map(|arrival| {
            if !safe_text(&arrival.cursor, 128, 256) {
                return Err("invalid_cursor");
            }
            let at_ms = timestamp(&arrival.at)?;
            if at_ms > generated.saturating_add(5000) {
                return Err("invalid_arrival_time");
            }
            let first_name = arrival
                .first_name
                .map(|name| {
                    let name = name.trim().to_owned();
                    if name.is_empty() {
                        Ok(None)
                    } else if safe_text(&name, 40, 160) {
                        Ok(Some(name))
                    } else {
                        Err("invalid_name")
                    }
                })
                .transpose()?
                .flatten();
            Ok(Arrival {
                cursor: arrival.cursor,
                at_ms,
                first_name,
            })
        })
        .transpose()?;
    Ok(Observation {
        count: source.current_count,
        check_in,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Greeting {
    pub id: String,
    pub first_name: Option<String>,
    pub expires_at: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Visible {
    pub count: u32,
    pub position: Position,
    pub greeting: Option<Greeting>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlayerState {
    #[serde(flatten)]
    pub visible: Visible,
    pub valid_until: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Intent {
    pub configuration_revision: i64,
    pub created_at_ms: i64,
    pub state: PlayerState,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookkeeping {
    pub established: bool,
    pub observed_cursor: Option<String>,
    pub maximum_check_in_at_ms: Option<i64>,
    pub last_success_ms: Option<i64>,
    pub current_count: Option<u32>,
    pub source_unavailable: bool,
    pub configuration_revision: Option<i64>,
    pub active_greeting: Option<Greeting>,
    pub published_visible: Option<Visible>,
    pub last_publication_ms: Option<i64>,
    pub pending: Option<Intent>,
}
impl Bookkeeping {
    /// Persist the complete returned record before publishing `pending`.
    pub fn observe(
        &mut self,
        observation: Observation,
        enabled: bool,
        configuration: &Configuration,
        revision: i64,
        now: i64,
    ) -> Result<(), &'static str> {
        let recovering = self
            .last_success_ms
            .is_some_and(|last| now.saturating_sub(last) >= VALIDITY_MS);
        let reconfigured = self.configuration_revision != Some(revision);
        if recovering || reconfigured || !enabled || !configuration.personalized_greetings {
            self.active_greeting = None;
            self.pending = None;
        }
        if self.active_greeting.as_ref().is_some_and(|greeting| {
            !timestamp(&greeting.expires_at).is_ok_and(|deadline| deadline > now)
        }) {
            self.active_greeting = None;
        }
        if let Some(arrival) = observation.check_in {
            let new_arrival = self.established
                && self.observed_cursor.as_ref() != Some(&arrival.cursor)
                && self
                    .maximum_check_in_at_ms
                    .is_none_or(|maximum| arrival.at_ms > maximum);
            self.maximum_check_in_at_ms = Some(
                self.maximum_check_in_at_ms
                    .map_or(arrival.at_ms, |maximum| maximum.max(arrival.at_ms)),
            );
            self.observed_cursor = Some(arrival.cursor.clone());
            let expires_ms = arrival.at_ms.min(now).saturating_add(GREETING_MS);
            if new_arrival
                && !recovering
                && !reconfigured
                && enabled
                && configuration.personalized_greetings
                && expires_ms > now
            {
                let id = format!(
                    "{:x}",
                    Sha256::digest(format!("{}@{}", arrival.cursor, arrival.at_ms).as_bytes())
                );
                self.active_greeting = Some(Greeting {
                    id,
                    first_name: arrival.first_name,
                    expires_at: iso(expires_ms)?,
                });
            }
        } else {
            self.observed_cursor = None;
        }
        self.established = true;
        self.configuration_revision = Some(revision);
        self.last_success_ms = Some(now);
        self.current_count = Some(observation.count);
        self.source_unavailable = false;
        if !enabled {
            self.published_visible = None;
            self.last_publication_ms = None;
            return Ok(());
        }
        let visible = Visible {
            count: observation.count,
            position: configuration.position,
            greeting: self.active_greeting.clone(),
        };
        let retry = self.pending.as_ref().is_some_and(|intent| {
            intent.configuration_revision == revision
                && intent.state.visible == visible
                && timestamp(&intent.state.valid_until).is_ok_and(|deadline| deadline > now)
        });
        if retry {
            return Ok(());
        }
        self.pending = None;
        if reconfigured
            || self.published_visible.as_ref() != Some(&visible)
            || self
                .last_publication_ms
                .is_none_or(|last| now.saturating_sub(last) >= REFRESH_MS)
        {
            self.pending = Some(Intent {
                configuration_revision: revision,
                created_at_ms: now,
                state: PlayerState {
                    visible,
                    valid_until: iso(now.saturating_add(VALIDITY_MS))?,
                },
            });
        }
        Ok(())
    }
    pub fn publication_succeeded(&mut self) {
        if let Some(intent) = self.pending.take() {
            self.published_visible = Some(intent.state.visible);
            self.last_publication_ms = Some(intent.created_at_ms);
        }
    }
    pub fn source_failed(&mut self) {
        self.source_unavailable = true;
    }
}
