use crate::model::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tilecast_package_guest::{ListInput, host_io, runtime_state, targets_v2};

const CONTRIBUTION: &str = "weeklywildcat.library-presence.library_presence";
const KEY: &str = "presence-v1";

fn load() -> Result<Bookkeeping, ()> {
    host_io::get(KEY)
        .map_err(|_| ())?
        .map(|raw| serde_json::from_slice(&raw).map_err(|_| ()))
        .transpose()
        .map(|record| record.unwrap_or_default())
}
fn save(record: &Bookkeeping) -> Result<(), ()> {
    host_io::set(KEY, &serde_json::to_vec(record).map_err(|_| ())?).map_err(|_| ())
}
fn config(value: &Value) -> Result<Configuration, ()> {
    if value.is_null() || value.as_object().is_some_and(|object| object.is_empty()) {
        return Ok(Configuration::default());
    }
    serde_json::from_value(value.clone()).map_err(|_| ())
}
fn poll() -> Result<(), ()> {
    let view = runtime_state::get(CONTRIBUTION).map_err(|_| ())?;
    let configuration = config(&view.configuration)?;
    let mut record = load()?;
    let now = i64::try_from(host_io::wall_now_ms()).map_err(|_| ())?;
    let source = host_io::fetch(SOURCE_URL, SOURCE_MAX_BYTES)
        .map_err(|_| ())
        .and_then(|bytes| parse_source(&bytes, now).map_err(|_| ()));
    let observation = match source {
        Ok(source) => source,
        Err(()) => {
            record.source_failed();
            save(&record)?;
            return Err(());
        }
    };
    record
        .observe(
            observation,
            view.enabled,
            &configuration,
            view.configuration_revision,
            now,
        )
        .map_err(|_| ())?;
    // Arrival bookkeeping and the original event deadline become durable
    // together, before the publication side effect can succeed.
    save(&record)?;
    if let Some(intent) = record.pending.clone() {
        runtime_state::publish(&runtime_state::Publish {
            contribution_id: CONTRIBUTION.to_owned(),
            configuration_revision: intent.configuration_revision,
            valid_until: intent.state.valid_until.clone(),
            state: serde_json::to_value(intent.state).map_err(|_| ())?,
        })
        .map_err(|_| ())?;
        record.publication_succeeded();
        save(&record)?;
    }
    Ok(())
}

#[unsafe(no_mangle)]
pub extern "C" fn run_job(ptr: u32, len: u32) -> i32 {
    if ptr != host_io::INPUT_ADDRESS || len != 8 {
        return -1;
    }
    // SAFETY: Package API 4 supplies this non-null, bounded reserved window.
    if unsafe { std::slice::from_raw_parts(ptr as *const u8, len as usize) } != b"presence" {
        return -1;
    }
    if poll().is_ok() { 0 } else { -1 }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum UiRequest {
    Get,
    Save {
        enabled: bool,
        configuration: Configuration,
        targets: targets_v2::Targets,
        revision: i64,
    },
    Options {
        kind: targets_v2::Kind,
        page: i64,
        query: Option<String>,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    enabled: bool,
    configuration: Configuration,
    targets: Option<targets_v2::Targets>,
    revision: i64,
    connection: &'static str,
    current_count: Option<u32>,
    last_success: Option<String>,
}
fn status(view: runtime_state::View) -> Result<Value, ()> {
    let record = load()?;
    let now = i64::try_from(host_io::wall_now_ms()).map_err(|_| ())?;
    let connection = match record.last_success_ms {
        None => "waiting",
        Some(last) if now.saturating_sub(last) >= VALIDITY_MS => "stale",
        Some(_) if record.source_unavailable => "reconnecting",
        Some(_) => "connected",
    };
    serde_json::to_value(Status {
        enabled: view.enabled,
        configuration: config(&view.configuration)?,
        targets: view.targets,
        revision: view.configuration_revision,
        connection,
        current_count: record.current_count,
        last_success: record
            .last_success_ms
            .map(iso)
            .transpose()
            .map_err(|_| ())?,
    })
    .map_err(|_| ())
}
fn ui(request: UiRequest) -> Result<Value, ()> {
    match request {
        UiRequest::Get => status(runtime_state::get(CONTRIBUTION).map_err(|_| ())?),
        UiRequest::Save {
            enabled,
            configuration,
            targets,
            revision,
        } => {
            let view = runtime_state::configure(&runtime_state::Configure {
                contribution_id: CONTRIBUTION.to_owned(),
                enabled,
                configuration: serde_json::to_value(configuration).map_err(|_| ())?,
                targets,
                expected_configuration_revision: revision,
            })
            .map_err(|_| ())?;
            status(view)
        }
        UiRequest::Options { kind, page, query } => {
            if !(1..=1000).contains(&page) || query.as_ref().is_some_and(|query| query.len() > 100)
            {
                return Err(());
            }
            serde_json::to_value(
                targets_v2::options(&targets_v2::OptionsInput {
                    kind,
                    page: ListInput {
                        page,
                        page_size: 50,
                        search: query.unwrap_or_default(),
                        ..Default::default()
                    },
                })
                .map_err(|_| ())?,
            )
            .map_err(|_| ())
        }
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn handle_ui_request(ptr: u32, len: u32, out: u32, cap: u32) -> i32 {
    // SAFETY: the host invokes this export with separate API 4 windows.
    let request = match unsafe { host_io::read_request::<UiRequest>(ptr, len) } {
        Ok(request) => request,
        Err(_) => return -1,
    };
    let response = match ui(request) {
        Ok(value) => json!({"ok": true, "data": value}),
        Err(()) => {
            json!({"ok": false, "message": "This request could not be completed. Refresh and try again."})
        }
    };
    // SAFETY: host_io validates the reserved output address and bounded length.
    unsafe { host_io::write_answer(out, cap, &response) }.unwrap_or(-1)
}
