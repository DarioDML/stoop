# Raw optical (PPG) and motion (accelerometer + gyro)

Full design, 2026-11-28. The owner asked to "get these working" for the two Developer → Streams rows that said "not decoded yet". They added: investigate deeply, decide where the data belongs, and look at how WHOOP, Bevel and Fitbit Air use it. Owner decisions are marked **(owner)**. My own calls are marked **(my call)**.

## Intent
- The band can stream raw optical and motion data. OpenHoop did not use either.
- The band also stores raw optical windows in its normal history, and OpenHoop threw them away.
- The goal is for all of this to work end to end, and for each kind of data to land where it is useful:
  - a developer view that shows and records the streams;
  - storage of what the band already records;
  - motion in strength workouts, which is what WHOOP uses it for ("Muscular Load").

## What is known
All of this was probed on the owner's MG band (firmware 50.43.2.0) on 2026-11-28, with a throwaway build (branch `spike/raw-stream-probe`, not merged), and from the owner's own history export.

### Live streams
Both arrive as packet 43 on the data characteristic.

**Motion:** `TOGGLE_IMU_MODE` (106) with body `[01 01]` starts it and `[01 00]` stops it.
- The band sends one R21 record per second: 100 accelerometer and 100 gyro samples per axis (100 Hz).
- The first record can have 0 gyro samples, and the next can have gyro values of -32768 (warm-up). After that the gyro is valid.
- `GET_GYRO_MODE` (152) read `[01 00 00]`, and the gyro streamed anyway.
- Accelerometer scale: the mean |a| of a still wrist was 1.003–1.004 g at 1/4096 g per LSB.
- Gyro scale: 1/16.384 °/s per LSB (±2000 °/s full scale, the community convention). This is not independently checked.

**Optical:** `TOGGLE_OPTICAL_MODE` (108) with body `[01 01]` starts it and `[01 00]` stops it.
- The band sends one R20 record per second: 5 blocks, each with slot A and slot B, as i32 samples. Live there are 25 samples per active block per second (25 Hz). During an ECG it was 50 per second.
- Which blocks are active:
  - Blocks 0, 3 and 4 carry data.
  - Blocks 1 (LED 3, drive 12750) and 2 (LED 2, drive 5300) are empty. They are probably the red/IR pair used only in SpO2 windows.
- What each active block is, from 66 s still:

  | Block | LEDs and detectors | Signal | Reading |
  |---|---|---|---|
  | 0 | LED 1 at drive 2750 on detector 3 (slot A); LED 4 at drive 5500 on detector 4 (slot B) | Strongest pulse: perfusion index 0.66 % on A, 0.25 % on B. Both near 75–79 bpm | The pulse channel; likely green |
  | 3 | All drives 0 | No pulse | Dark / ambient reference |
  | 4 | LED 2 at drive 200 on detector 3; slot B on detector 1 with drive 0 | High baseline, weak pulse | Likely the IR wear check |

- Wavelengths are inferred, not read from the band, so they are shown as "likely".

**Other live behaviour:**
- Both streams can run at once. Their records share one record index.
- Neither stream needs `START_RAW_DATA` (81) first.
- Both keep running until switched off. They also kept running after an 81 session ended.
- No source says what a disconnect does. The community reports one ECG stream that survived a disconnect for 40 minutes.

### On-band raw session
- `START_RAW_DATA` (81) makes the band save R20 and R21 into its own history (packet 47), from about 5 s before the start until `STOP_RAW_DATA` (82) `[01]` or until the duration runs out. A sync reads them.
- Bodies and replies:
  - Revision 2 is `[02][u32 duration ms]`, and the reply echoes the duration.
  - Revision 1 `[01]` replied `01 00 5c 26 05 00 00`, which is not understood.
- Event 124 arrives 4 times at the start and twice at the end. Its payload is not decoded.
- Cost: a sync read band-saved raw data at about 15 KB/s. Optical and motion together are about 3.4 KB/s, so one hour is about 12 MB and about 13 minutes of extra sync.

### History the band already sends
- **R26 compact optical:** 40-second windows of 25 Hz samples, about every 20 minutes, day and night. That is 5,600 records in 47.5 h, about 0.25 MB a day.
- **R20, R21 and R16** are also saved during an ECG reading, because the ECG turns on "raw save".
- OpenHoop keeps these frames in `raw_chunks`. Nothing decodes them into the existing, unused tables `optical_bursts` and `imu_blocks`.

### How others use it
From research on 2026-11-28; sources are in the PR.

- **WHOOP:**
  - The accelerometer and gyroscope feed Strength Trainer and Muscular Load (volume and intensity per rep), sleep staging, and motion handling of heart rate (patent US 12,279,852).
  - Red/IR is used for SpO2.
  - Users get no raw data. The API is summaries only.
- **Bevel:**
  - App only.
  - It splits strain into cardio (heart rate) and muscular. Muscular comes from sets × reps × weight, plus Apple Watch motion for lifts logged in its own Watch app.
  - Muscular load is shown per muscle, last 7 days against 6 weeks.
- **Fitbit Air:**
  - Screenless, released 2026.
  - Red/IR is used for SpO2 only in still sleep, plus HRV, AFib alerts and cardio load.
  - No raw data.
- **Polar SDK:** the reference for exposing raw streams. It offers selectable rates and ranges, and units on every value.

## Goals
1. **Developer → Streams works.** **(owner)**
   - The "Not decoded yet" chips become switches for optical and motion.
   - While a stream runs, the tab shows:
     - live traces: accelerometer x/y/z in g, gyro x/y/z in °/s, and optical per active channel in raw counts, labelled by LED, detector and drive, with "likely green / likely IR / dark reference";
     - the measured rate;
     - the sample count.
   - **Record** saves a CSV with units next to the existing packet sessions.
   - The rows also explain themselves in place.
   - Raw traces stay in Developer mode. **(owner)**
2. **Optical and motion stored from history.** Sync decodes into `imu_blocks` and `optical_bursts`:
   - R26 windows;
   - R20 and R21 records, from ECG raw save and from on-band recordings.
   - A decoder version bump backfills them once from the stored raw chunks. The existing raw-data retention prunes them, and they are part of the database export.
3. **High-rate motion during workouts works.** The disabled "High-rate motion during workouts" switch in Device becomes real.
   - When it is on and a strength session is live in the app, the app streams motion live for the whole session and stores it per second. **(owner: live only)**
   - A session can also switch on **Record on band** (off by default), for when the phone stays in a locker. **(owner)** It runs the on-band raw session for the length of the session. The screen states the cost: band memory, and about 13 extra minutes of sync per hour.
4. **Per-set motion metrics.**
   - Each logged set is matched to its **active bout**: the last contiguous stretch of lifting movement before its `done_at`, searched within the 120 s before it. The rest period before the bout (walking, loading plates, the phone) is never analysed. **(owner review)**
   - From the bout the app derives:
     - reps detected;
     - time under tension (the bout's movement time);
     - mean rep duration (tempo);
     - velocity loss, the drop in peak dynamic acceleration from the first to the last reps, as a fatigue sign.
   - Detected reps never overwrite the reps field, which the plan or the previous set already fills. They show as a one-tap suggestion ("Band counted 7 · Use"). **(owner review)**
   - Some exercises barely move the wrist, such as the leg press, machine calf raises or isometric holds. When a bout has fewer than 2 reps or stays under the noise floor, the set shows "motion not readable for this exercise", uses factor 1 and gets no suggestion.
5. **Motion-weighted muscular load.** **(owner)**
   - A set's load is its volume (reps × weight) times an intensity factor.
   - Peak acceleration falls on heavy, near-failure sets and rises on light, fast ones, so it would weight sets the wrong way round. **(owner review)** The factor therefore comes from **tempo**: the set's mean rep duration divided by the user's own median rep duration for that exercise over earlier readable sets, clamped to 0.7–1.3. Slower reps mean a heavier relative load or fatigue, so they weigh more.
   - Velocity loss is stored and shown, but does not change the factor in `strength.motion@1`.
   - Factor 1 (plain volume) applies to:
     - sets without readable motion;
     - every set until the exercise has 3 earlier readable sets as a reference.
   - The strength summary says which sets had motion. It carries level D and a method sheet.
   - **Validation before the factor counts:** the owner logs one light and one heavy working set of the same exercise and checks, from the Developer CSV and the summary, that the heavy set gets the higher factor. Until that check passes, the build shows the factor but computes load as plain volume. One constant switches it on.
6. **ECG movement line.**
   - The band saves R21 during an ECG reading, and a sync brings it in. After that sync, the reading's wrist movement (the 75th percentile of the per-second RMS of dynamic acceleration, in g, so a hand settling in the first seconds does not make a still reading look moving; changed after the S24 check, `ecg.movement-p75@1`) is computed once and **stored on the ECG record**, so it survives pruning of the raw motion. **(owner review)**
   - The result shows it as a reason for a noisy trace. It is a fact, not a verdict.
7. **Post-sync recompute.** **(owner review)** After every sync that stores new motion rows, the app recomputes:
   - `strength_set_motion` for each strength session that overlaps the new rows and still has sets without readable motion. This is what makes "Record on band" fill in a workout afterwards.
   - the ECG movement value for readings that don't have one yet.
8. **Logging sets after the fact.**
   - With the phone in a locker, sets may be logged after the lifting, so `done_at` no longer lines up with the bouts. The search before `done_at` then finds no bout for most sets.
   - In that case the session's bouts are found from motion alone. If their number equals the number of logged sets, they are assigned in order. Otherwise those sets show "motion recorded, but it couldn't be matched to your sets".
9. **Safety:**
   - Every stream the app starts is also stopped:
     - when its screen or session ends;
     - after a 10-minute cap on Developer streams;
     - after a 4-hour cap on live workout motion;
     - on app close where possible;
     - on the next connect, through a cleanup flag set while streaming, as the ECG already does.
   - **Reconnect during a workout.** **(owner review)** On every connect the controller first asks whether a stream owner is active in memory (the strength live screen with high-rate motion, or the Developer tab):
     - if one is, it re-sends that owner's switch-on (106 or 108 `[01 01]`) and leaves the flag set;
     - only with no owner does it send the flagged switch-offs.
   - **Fail-safe:** a live R20 or R21 arriving while the app runs no stream is answered with stream-off, at most once every 30 s.
     - It ignores packets for 3 s after the app's own stop, because of in-flight records. **(owner review)**
     - It only reacts to packets on OpenHoop's own connection.
     - It is off during an ECG reading and during a sync.
   - The app never sends `TOGGLE_PERSISTENT_R20/R21` (153/154). The community links them to a stuck LED and battery drain, and they write nonvolatile state.
10. **Retention.** "Raw 7 d" and "Raw 30 d" also delete `imu_blocks` and `optical_bursts` rows by their own time `t` < cutoff, whatever their `chunk_id`, so live workout rows are pruned too. "Keep all", the default, deletes nothing. Derived values stay: `strength_set_motion`, the ECG movement value, and detected reps. **(owner)**

## Non-goals
- Muscular load counting toward the daily Load score. Daily Load stays heart-rate based and calibrated. Muscular load is shown next to it. **(owner)** The Load screen's note "Muscular load is not included yet" stays true and stays.
- A regular-user "live sensors" screen. **(owner)**
- New health metrics computed from raw optical: respiratory rate, HRV from PPG, pulse rate from R26. They are possible later. The band's own values stay the source.
- Decoding event 124, R22 and gyro mode (150/152).
- Selectable rates or ranges. The band offers none we know of.

## Anti-goals
These would make it a failure even if it technically works:
- A stream left running on the band after the app thinks it is off, draining the battery.
- Blood pressure or a heart-rhythm verdict from the optical signal. README and LEGAL promise neither, matching the earlier ECG decision.
- Calling a channel "green", "red" or "IR" as fact. The labels say "likely" and the why-sheet gives the evidence.
- Muscular load that silently changes meaning. The method sheet and level D say it is weighted by motion only when motion exists.
- Filling the band's memory without saying so. On-band recording is opt-in, time-limited, and shows its cost.

## Constraints
- **Commands and protocol:**
  - Commands 106, 108, 81 and 82 are already in the `write` class (`confirmWrite`). No new command classes are needed.
  - Live records share packet 43 with the ECG's R17. ECG, live streams and sync stay mutually exclusive through the existing busy rules. Live heart rate (standard profile) may run alongside motion, as strength sessions need.
- **Storage and app rules:**
  - Database: one new migration. Migration SQL already on the phone stays unchanged. The migration:
    - adds a `layout` column to `optical_bursts`, holding 20 or 26;
    - removes any duplicates (the tables have had no writer, so they should be empty);
    - adds unique indexes on `imu_blocks (device_id, t)` and `optical_bursts (device_id, t, layout)`, so live and history copies of the same second do not double;
    - creates `strength_set_motion`;
    - adds `movement_g` to `ecg_recordings`.
  - Layouts must hold at 360 dp with font scale 1.3.
  - New metric names get `terms.ts` entries (en + nl) and explain in place.
  - UI proposals go on the Claude Design canvas before building.
- **Throughput:** about 1.2 KB/s for motion and 2.1 KB/s for optical, well within what the BLE link already carries during sync.

## Approaches
### Stream control
1. **A core module modelled on `ecg.ts` (picked):**
   - `startStreams` / `stopStreams`, plus a collector that turns R20/R21 packets into timed samples;
   - a cleanup flag in settings;
   - the fail-safe in the controller.

   It reuses the proven ECG pattern (busy rules, cleanup on reconnect) and is testable against the simulator.
2. **Ad-hoc commands from the screens.** Cheaper, but cleanup and fail-safe logic would be repeated and easy to miss.

### Workout motion source (owner)
1. **Live only, with opt-in on-band recording (picked).**
2. Always record on band as well: no gaps, but about 13 min extra sync per hour.
3. On-band only: no live reps.

### Muscular load (owner)
1. **Weight volume by per-set motion intensity against a personal reference (picked).**
2. Show motion metrics next to unchanged volume.

### History storage
1. **Decode into the existing `imu_blocks` and `optical_bursts` tables at sync, with a backfill through the decoder version (picked).** The tables, retention and chunk references already exist.
2. Decode from `raw_chunks` on demand. No storage cost, but every reader would have to inflate chunks.

## Decided
- **Protocol:**
  - R21 drops gyro triplets holding -32768 (marked missing).
  - Both record bodies report their sample rate: R21 byte 22; for R20, the count per active block per one-second record.
  - Requests get named body builders: `streamSwitchBody(on)`, `rawSessionBody(ms)`, `rawStopBody()`.
  - Event 124 gets an own name ("RAW_SESSION_STATE") with an undecoded payload.
  - The schema evidence for R20 and R21 gains `own`.
  - `docs/provenance.md` gains rows for every fact above.
- **Stored formats:**
  - `imu_blocks.data` is packed little-endian:
    - `[u8 version=1][u8 rate][u16 na][u16 ng]`;
    - then the accelerometer x, y and z arrays (i16), then the gyro arrays (i16, invalid samples kept as -32768).
  - `optical_bursts.data` is packed little-endian:
    - `[u8 version=1][u8 layout][u8 rate][u8 blocks]`;
    - for each block, `[u8 sourceA][u16 driveA][u8 detectorA][u8 sourceB][u16 driveB][u8 detectorB][u16 count]` followed by slot A then slot B samples (i32);
    - R26 is stored as one block with slot A only, holding the reconstructed samples.
- **Developer streams:**
  - They stop when the Streams tab unmounts or after 10 minutes, whichever is first.
  - The CSV has one file per stream:
    - motion: `t_ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps`;
    - optical: `t_ms,block,slot,led,detector,drive,value`.
    - `t_ms` is band time (unix + subsec/32768 + i/rate) in ms.
- **Workouts:**
  - Live motion runs only while the strength live screen's session is open and the setting is on.
  - Live seconds are written to `imu_blocks` with `chunk_id` NULL.
  - "Record on band" sends 81 revision 2 with duration = 3 h at the session start, and 82 at the session end.
- **Bout segmentation:**
  - Remove gravity with a **3 s** moving average per axis. A 1 s average would cut slow 3–5 s reps before the band-pass. **(owner review)**
  - The energy envelope is the 0.5 s RMS of dynamic |a| plus |gyro|.
  - The active bout is the last stretch before `done_at`, within 120 s, where the envelope stays above an activity threshold, merged across gaps under 2 s.
  - The threshold is relative: 3 × the median envelope of the quiet seconds in the same 120 s.
- **Rep detection, run on the bout only:**
  - Project onto the bout's principal axis of dynamic acceleration.
  - Band-pass 0.15–2.5 Hz.
  - Count peaks at least 0.6 s apart whose prominence is at least 35 % of the **bout's** 90th-percentile amplitude.
- **Per-set values:**
  - Tempo = bout duration / reps.
  - Time under tension = the bout's duration.
  - Velocity loss = 1 − (mean peak of the last 2 reps / mean peak of the first 2 reps).
  - Readable = at least 2 reps, and a bout amplitude of at least 0.03 g.
  - Coverage is measured against the bout, not the rest interval. Readable needs at least 80 % of the bout's seconds present.
- Thresholds are a first version, named in one constants object, algo id `strength.motion@1`.

These were settled after the builder check. **(my call)**
- **Writes:**
  - Rows are written with `INSERT OR IGNORE`, so the first copy of a second wins. A live copy and a band-saved copy of the same second carry the same samples.
  - `t` is the record's band unix second, as in `samples_1hz`.
  - Each R26 record is one second (25 samples), so a 40-second window is 40 rows with layout 26.
- **Backfill:** a `SAMPLE_DECODER_VERSION` bump re-decodes the stored chunks once through the existing `rebuildStaleSamples` path.
  - It runs in the background (`redecodeStoredSamples` is not awaited at startup) and shows the existing progress line. R26 decoding is cheap.
  - The rows are inserted per chunk, so a run cut short repeats harmlessly through `INSERT OR IGNORE`.
- **Cleanup flag:** it records which of motion, optical and the on-band recording were on. The next connect sends 106 off, 108 off and 82 for exactly those. The 3-hour duration also caps an on-band recording orphaned by a dead app.
- **Fail-safe:** it only reacts to packets on OpenHoop's own connection, and it is off during an ECG reading and during a sync.
- **Set timing:**
  - Set windows are in phone time, and they are converted to band time with the session's measured clock offset (`Session.clockOffsetS`).
  - A set counts as having motion when at least 80 % of its window's seconds have a motion row. Otherwise it shows "no motion" and uses factor 1.
- **Per-set results:**
  - They are stored in `strength_set_motion`, with these columns:
    - `set_id` (key → `strength_sets`, on delete cascade);
    - `status` (`readable`, `unreadable`, `unmatched` or `none`);
    - `reps_detected`, `tut_s`, `tempo_s`, `velocity_loss`, `coverage`, `factor` and `algo`.
  - The personal reference median is computed from that table, so muscular load survives when raw motion is pruned.
  - The ECG movement value is a nullable column `movement_g` on `ecg_recordings`, in the same migration.
- **Sample rate:** the R21 rate byte is used when it is not 0; otherwise the rate is the sample count per one-second record.

## Owner review, 2026-11-28
The owner approved the design ("a very solid design") and asked for these fixes, now in Goals 4–10 and Decided:
- active-bout segmentation instead of the whole rest interval;
- a 3 s gravity window;
- a tempo-based factor instead of peak acceleration, validated on a light and a heavy set before it counts;
- reconnect during a workout re-asserts the stream instead of cleaning it up;
- a post-sync recompute for "Record on band" and for the ECG movement value;
- matching sets logged after the fact;
- suggestions instead of overwriting planned reps;
- a 3 s fail-safe grace and a 4-hour live cap;
- the ECG movement value stored on the record;
- retention by time.

Retention answer: yes, prune by `t`.

## Left to the builder
- Exact strings (en + nl), chart styling within the canvas design, and how traces are downsampled for drawing.
- The test fixtures. Build synthetic frames shaped like the real ones; the owner's own frames are not committed.
- How the existing strength screens fit the new per-set line, once the canvas artboards are approved.
- The PR split: protocol + core + storage, Developer streams, workout motion + muscular load, ECG line.
