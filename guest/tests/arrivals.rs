use library_presence::model::*;
use serde_json::json;
const NOW: i64 = 1_800_000_000_000;
fn source(now: i64, count: u32, arrival: Option<(&str, i64, Option<&str>)>) -> Observation {
    let latest = arrival.map(
        |(cursor, at, name)| json!({"cursor": cursor, "at": iso(at).unwrap(), "firstName": name}),
    );
    parse_source(&serde_json::to_vec(&json!({"schemaVersion": 1, "currentCount": count, "generatedAt": iso(now).unwrap(), "latestCheckIn": latest})).unwrap(), now).unwrap()
}
fn observe(
    record: &mut Bookkeeping,
    now: i64,
    count: u32,
    arrival: Option<(&str, i64, Option<&str>)>,
) {
    record
        .observe(
            source(now, count, arrival),
            true,
            &Configuration::default(),
            1,
            now,
        )
        .unwrap();
}
fn baseline() -> Bookkeeping {
    let mut record = Bookkeeping::default();
    observe(
        &mut record,
        NOW,
        12,
        Some(("100", NOW - 1000, Some("Gibson"))),
    );
    assert!(record.active_greeting.is_none());
    record.publication_succeeded();
    record
}
#[test]
fn baseline_then_new_arrival_even_with_unchanged_count() {
    let mut record = baseline();
    observe(
        &mut record,
        NOW + 5000,
        12,
        Some(("101", NOW + 4000, Some("Gibson"))),
    );
    let greeting = record.active_greeting.as_ref().unwrap();
    assert_eq!(greeting.first_name.as_deref(), Some("Gibson"));
    assert_eq!(greeting.id.len(), 64);
    assert_eq!(greeting.expires_at, iso(NOW + 11000).unwrap());
    let state = serde_json::to_string(&record.pending.as_ref().unwrap().state).unwrap();
    for private in [
        "cursor",
        "generatedAt",
        "latestCheckIn",
        "signage.weeklywildcat.com",
        "101@",
    ] {
        assert!(!state.contains(private));
    }
}
#[test]
fn checkout_null_archive_and_restoration_never_greet_or_lower_the_maximum() {
    let mut record = baseline();
    observe(&mut record, NOW + 5000, 11, None);
    observe(
        &mut record,
        NOW + 10000,
        12,
        Some(("100", NOW - 1000, Some("Gibson"))),
    );
    observe(
        &mut record,
        NOW + 15000,
        9,
        Some(("90", NOW - 5000, Some("Earlier"))),
    );
    assert_eq!(record.maximum_check_in_at_ms, Some(NOW - 1000));
    assert!(record.active_greeting.is_none());
    observe(&mut record, NOW + 20000, 9, Some(("91", NOW - 1000, None)));
    assert!(record.active_greeting.is_none());
}
#[test]
fn identical_polls_do_not_publish_and_freshness_refreshes_at_thirty_seconds() {
    let mut record = baseline();
    for step in 1..6 {
        observe(
            &mut record,
            NOW + step * 5000,
            12,
            Some(("100", NOW - 1000, None)),
        );
        assert!(record.pending.is_none());
    }
    observe(
        &mut record,
        NOW + 30000,
        12,
        Some(("100", NOW - 1000, None)),
    );
    assert_eq!(
        record.pending.as_ref().unwrap().state.valid_until,
        iso(NOW + 105000).unwrap()
    );
}
#[test]
fn crash_retry_keeps_the_original_event_and_deadlines() {
    let mut record = baseline();
    observe(&mut record, NOW + 5000, 13, Some(("101", NOW + 4000, None)));
    let original = record.pending.clone().unwrap();
    let mut restarted: Bookkeeping =
        serde_json::from_slice(&serde_json::to_vec(&record).unwrap()).unwrap();
    observe(
        &mut restarted,
        NOW + 10000,
        13,
        Some(("101", NOW + 4000, None)),
    );
    assert_eq!(restarted.pending.as_ref().unwrap().state, original.state);
    restarted.publication_succeeded();
    observe(
        &mut restarted,
        NOW + 15000,
        13,
        Some(("101", NOW + 4000, None)),
    );
    assert!(restarted.active_greeting.is_none());
}
#[test]
fn stale_recovery_restores_count_without_a_welcome() {
    let mut record = baseline();
    record.source_failed();
    observe(
        &mut record,
        NOW + 80000,
        13,
        Some(("101", NOW + 79000, Some("Gibson"))),
    );
    assert!(record.active_greeting.is_none());
    assert_eq!(record.pending.as_ref().unwrap().state.visible.count, 13);
    assert_eq!(record.maximum_check_in_at_ms, Some(NOW + 79000));
}
#[test]
fn disabled_and_nonpersonalized_modes_consume_arrivals_without_welcomes() {
    let mut record = baseline();
    record
        .observe(
            source(NOW + 5000, 13, Some(("101", NOW + 4000, Some("Gibson")))),
            false,
            &Configuration::default(),
            2,
            NOW + 5000,
        )
        .unwrap();
    assert!(record.pending.is_none());
    record
        .observe(
            source(NOW + 10000, 13, Some(("101", NOW + 4000, Some("Gibson")))),
            true,
            &Configuration::default(),
            3,
            NOW + 10000,
        )
        .unwrap();
    assert!(record.active_greeting.is_none());
    let config = Configuration {
        personalized_greetings: false,
        ..Default::default()
    };
    record
        .observe(
            source(NOW + 15000, 14, Some(("102", NOW + 14000, None))),
            true,
            &config,
            4,
            NOW + 15000,
        )
        .unwrap();
    assert!(record.active_greeting.is_none());
    assert_eq!(record.observed_cursor.as_deref(), Some("102"));
}
#[test]
fn invalid_sources_and_stale_data_are_rejected() {
    let valid = json!({"schemaVersion":1,"currentCount":12,"generatedAt":iso(NOW).unwrap(),"latestCheckIn":null});
    for (field, value) in [
        ("currentCount", json!(-1)),
        ("currentCount", json!(1.5)),
        ("currentCount", json!(100001)),
        ("schemaVersion", json!(2)),
        ("generatedAt", json!(iso(NOW - 30001).unwrap())),
        ("generatedAt", json!(iso(NOW + 5001).unwrap())),
    ] {
        let mut source = valid.clone();
        source[field] = value;
        assert!(parse_source(&serde_json::to_vec(&source).unwrap(), NOW).is_err());
    }
    assert!(parse_source(&vec![b' '; SOURCE_MAX_BYTES + 1], NOW).is_err());
}
#[test]
fn source_boundaries_accept_the_limits_and_refuse_the_next_value() {
    let at = |generated: i64, count: u32, cursor: &str, name: Option<&str>| {
        let latest = json!({"cursor": cursor, "at": iso(generated).unwrap(), "firstName": name});
        serde_json::to_vec(&json!({"schemaVersion":1,"currentCount":count,"generatedAt":iso(generated).unwrap(),"latestCheckIn":latest})).unwrap()
    };
    // Counts, freshness window, cursor and name lengths are inclusive limits.
    assert!(parse_source(&at(NOW, 0, "1", None), NOW).is_ok());
    assert!(parse_source(&at(NOW, 100_000, "1", None), NOW).is_ok());
    assert!(parse_source(&at(NOW, 100_001, "1", None), NOW).is_err());
    assert!(parse_source(&at(NOW - 30_000, 1, "1", None), NOW).is_ok());
    assert!(parse_source(&at(NOW - 30_001, 1, "1", None), NOW).is_err());
    assert!(parse_source(&at(NOW + 5000, 1, "1", None), NOW).is_ok());
    assert!(parse_source(&at(NOW + 5001, 1, "1", None), NOW).is_err());
    assert!(parse_source(&at(NOW, 1, &"c".repeat(128), None), NOW).is_ok());
    assert!(parse_source(&at(NOW, 1, &"c".repeat(129), None), NOW).is_err());
    assert!(parse_source(&at(NOW, 1, "", None), NOW).is_err());
    assert!(parse_source(&at(NOW, 1, "1", Some(&"é".repeat(40))), NOW).is_ok());
    assert!(parse_source(&at(NOW, 1, "1", Some(&"é".repeat(41))), NOW).is_err());
    // Whitespace-only names mean "no name", while controls and bidi marks are refused.
    assert!(parse_source(&at(NOW, 1, "1", Some("   ")), NOW).is_ok());
    assert!(parse_source(&at(NOW, 1, "1", Some("a\u{7}b")), NOW).is_err());
    assert!(parse_source(&at(NOW, 1, "1", Some("a\u{2067}b")), NOW).is_err());
    // A source of exactly the byte bound parses; one more byte is refused first.
    let mut padded = at(NOW, 1, "1", None);
    padded.resize(SOURCE_MAX_BYTES, b' ');
    assert!(parse_source(&padded, NOW).is_ok());
    padded.push(b' ');
    assert!(parse_source(&padded, NOW).is_err());
    // Unknown fields and a wrong shape never parse.
    let unknown = json!({"schemaVersion":1,"currentCount":1,"generatedAt":iso(NOW).unwrap(),"latestCheckIn":null,"extra":true});
    assert!(parse_source(&serde_json::to_vec(&unknown).unwrap(), NOW).is_err());
    assert!(parse_source(b"[]", NOW).is_err());
}
