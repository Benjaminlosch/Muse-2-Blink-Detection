# Literature Review — Blink Detection from EOG / Frontal EEG for a Muse 2 → ESP32 Prosthetic-Hand Control Interface

Prepared for the Muse 2 EEG-blink prosthetic-hand control project. Five papers were located via live web search (Google/Bing-backed WebSearch, CrossRef API, and direct publisher/PDF fetches) and verified against their own text, abstracts, or CrossRef metadata before being summarized here. Every numeric claim below is either sourced to a specific paper (with link) or explicitly marked **NOT VERIFIED** where the primary text could not be confirmed. Sections 21–23 in each write-up are explicitly the author's own engineering synthesis, not claims from the paper.

---

## Paper 1: MED: Muse™-based Eye-blink Detection Algorithm Using a Single EEG Channel

1. **Paper title**: "MED: Muse™-based Eye-blink Detection Algorithm Using a Single EEG Channel"
2. **Authors**: E. Shachar, A. Lev, O. Rosen (Faculty of Electrical Engineering, Technion – Israel Institute of Technology)
3. **Publication year**: 2022
4. **Journal/conference**: 2022 IEEE Signal Processing in Medicine and Biology Symposium (SPMB)
5. **DOI / URL**: DOI [10.1109/SPMB55497.2022.10014708](https://doi.org/10.1109/SPMB55497.2022.10014708); full text PDF verified at https://isip.piconepress.com/conferences/ieee_spmb/2022/papers/l01_03.pdf; IEEE listing https://ieeexplore.ieee.org/document/10014708/
6. **Acquisition hardware**: Muse™ 2014 headband (consumer EEG device), data transferred via MuseIO/MuseLab to a PC
7. **Sampling rate**: 220 Hz
8. **Electrodes/channels**: 4 channels available (TP9, AF7, AF8, TP10); algorithm uses a single channel, TP9 (chosen arbitrarily over TP10 because both are near the eyes)
9. **Preprocessing**: Local-minima detection on the raw signal first (before filtering, since filtering attenuates the eye-blink peak amplitude); minima require (a) ≥0.1 s minimum spacing between peaks and (b) amplitude ≥70 µV below the signal mean baseline. Signal then zero-mean normalized and filtered twice.
10. **High-pass cutoff**: NOT VERIFIED (paper does not specify a high-pass filter in Hz; filtering is done via a smoothing cascade, not a classical HPF/LPF pair)
11. **Low-pass cutoff**: NOT VERIFIED (no explicit Hz cutoff given; smoothing achieved via moving-average filters, see below)
12. **Notch filtering**: NOT VERIFIED — not mentioned in the paper
13. **Filter type and order**: Two cascaded filters, both empirically tuned: (1) exponential moving-average filter y[n] = αx[n] + (1−α)y[n−1] with α = 0.1; (2) standard moving-average (boxcar) filter with window length 0.01 s
14. **Thresholding method**: Fixed empirical amplitude thresholds — minima ≥70 µV below baseline to seed candidate blinks; a matching maximum within a search window must exceed 15 µV or the candidate is discarded (sanity check); blink start/end boundaries defined as the nearest points where the signal crosses back within −5 µV / +5 µV of baseline
15. **Blink features**: Local minima/maxima (eyelid-closing trough, eyelid-opening peak), peak-to-peak amplitude, inter-peak timing, blink duration
16. **Temporal detection method**: Deterministic time-domain state machine — find minima → find matching maxima within a bounded search window (min of time-to-next-minimum or 0.5 s) → define blink onset/offset via baseline-crossing points; no transform-domain (FFT/wavelet) processing, minimizing compute
17. **Artifact rejection**: Explicit sanity checks reject (a) minima too close together (<0.1 s, likely noise on a true peak), (b) minima without a qualifying matching maximum (≥15 µV) within the search window, and (c) partial blinks truncated at the start/end of a recording
18. **Classifier if any**: None — fully deterministic/rule-based, non-learning algorithm (explicitly contrasted against learned/CNN approaches for generalization reasons)
19. **Reported latency**: NOT VERIFIED — no wall-clock/real-time latency figure reported; paper only states the algorithm is "low-resource" and runs faster than transform-based alternatives conceptually, tested offline in MATLAB 2015a on an Intel Core i7 (4 GB RAM)
20. **Reported accuracy/sensitivity/specificity/precision**: 100% accuracy with 0% false positives on their own 3-subject, 200-second (12-session) manually annotated dataset; compared against Muse's built-in blink detector (96.8% accuracy, 18% of detections false-positive) and a prior STFT-based drowsiness-detection algorithm (72.3% accuracy, 11% false positive) — see their Table 1
21. **What we should borrow (synthesis)**: This is the single most directly transferable paper — it is literally a Muse-headband, single-forehead-channel, deterministic time-domain algorithm with a documented threshold cascade. We should replicate its two-stage minima-then-matching-maximum state machine and its baseline-crossing boundary definition as a first-pass detector, since it needs no training data and is cheap enough to port to an ESP32. The empirical 70 µV / 15 µV / ±5 µV thresholds and 0.1 s minimum inter-peak spacing are a reasonable starting point to tune against our own recordings.
22. **What we should NOT borrow (synthesis)**: Their dataset is tiny (3 subjects, 200 s total) and blinks were requested in isolation ("blink naturally while performing no other actions") — this is not validated against motion artifact, jaw clenching, or EMG contamination that a prosthetic-hand user will generate, and the 100%/0-false-positive result should not be treated as representative of real-world robustness. The fixed absolute-µV thresholds (70 µV, 15 µV) are calibrated to their specific amplifier/gain chain and will likely need rescaling for our hardware.
23. **Applicability to Muse 2 + ESP32 (synthesis)**: Very high. It is one of very few papers built specifically on a Muse-family headband and a single frontal/near-eye channel, and its low-complexity time-domain approach (no FFT/wavelet transform, just IIR/moving-average smoothing and comparisons) is well matched to ESP32 compute constraints. Note the original used a 2014 Muse variant at 220 Hz; our Muse 2 typically streams at 256 Hz EEG sampling — thresholds/window lengths in samples will need re-derivation, not just direct reuse.

---

## Paper 2: RT-Blink: A Method Toward Real-Time Blink Detection From Single Frontal EEG Signal

1. **Paper title**: "RT-Blink: A Method Toward Real-Time Blink Detection From Single Frontal EEG Signal"
2. **Authors**: Yuang Zhang, Xiangwei Zheng, Weizhi Xu, Hong Liu
3. **Publication year**: 2023
4. **Journal/conference**: IEEE Sensors Journal, vol. 23, no. 3, pp. 2794–2802
5. **DOI / URL**: DOI [10.1109/JSEN.2022.3232176](https://doi.org/10.1109/JSEN.2022.3232176) (confirmed via CrossRef bibliographic lookup); IEEE listing https://ieeexplore.ieee.org/document/10006405/ (full text behind an IEEE Xplore paywall that could not be fetched directly — see caveats below)
6. **Acquisition hardware**: NOT VERIFIED — could not confirm exact device/amplifier from the abstract/search snippets alone
7. **Sampling rate**: NOT VERIFIED
8. **Electrodes/channels**: Single frontal EEG channel (paper title and consistent secondary summaries confirm single-channel, frontal placement), but the specific electrode label is NOT VERIFIED
9. **Preprocessing**: NOT VERIFIED in detail beyond the windowing scheme below
10. **High-pass cutoff**: NOT VERIFIED
11. **Low-pass cutoff**: NOT VERIFIED
12. **Notch filtering**: NOT VERIFIED
13. **Filter type and order**: NOT VERIFIED
14. **Thresholding method**: Uses a "potential blink (PB) boundary detecting algorithm" prior to classification (algorithmic boundary proposal, not a single fixed amplitude threshold), per corroborating secondary summaries; exact rule NOT VERIFIED from primary text
15. **Blink features**: Sample entropy (SampEn), standard deviation (SD), range of amplitude (RA), and "rate of grade" (RG), computed per sliding window
16. **Temporal detection method**: Short sliding-window approach — window length 60 ms — with a potential-blink boundary detector feeding a classifier; window size is described as tunable to hardware processing speed
17. **Artifact rejection**: NOT VERIFIED beyond the boundary-detection pre-filtering step
18. **Classifier if any**: Pre-trained random forest (RF) model operating on the four features above
19. **Reported latency**: Average processing time of 5.07 ms per 60 ms time window (reported consistently across independent search summaries; standard deviation ~1.65 ms was reported in one summary but is only single-sourced, so treat that specific SD figure as **NOT VERIFIED**)
20. **Reported accuracy/sensitivity/specificity/precision**: Average sensitivity 96.54%, average precision 91.25% (consistent across multiple independent secondary sources, but not confirmed against the primary IEEE full text, which could not be fetched — treat as corroborated-but-not-primary-verified)
21. **What we should borrow (synthesis)**: The core idea — a short (tens-of-ms) sliding window with a small feature set (entropy/variance/amplitude-range/slope) feeding a lightweight classifier — is a good template for an ESP32 pipeline where full waveform template-matching is too expensive. A random forest with 4 scalar features per window is cheap enough to reimplement as fixed-point/table logic on a microcontroller.
22. **What we should NOT borrow (synthesis)**: Do not port their exact trained model weights (we have no verified access to them and no verified detail on training data/hardware match to our Muse 2 signal characteristics). Because several methodological fields (sampling rate, filter band, electrode site) could not be verified from primary text, we should not assume their preprocessing chain matches ours without independently deriving our own filter parameters.
23. **Applicability to Muse 2 + ESP32 (synthesis)**: Moderate-to-high in concept (single-channel, frontal, real-time, sub-10ms compute budget per window is very ESP32-compatible), but low in directly reusable numeric parameters since key acquisition/filtering details could not be verified here. Treat this paper as validating the sliding-window-plus-lightweight-classifier *architecture*, not as a source of filter cutoffs or thresholds — we will need to derive those from our own Muse 2 data or from Papers 1/4 below. **Caveat**: because IEEE Xplore blocked automated fetching of the full text, this summary leans on search-engine-extracted snippets for items 14–20; the title/authors/venue/DOI were independently confirmed via CrossRef, but a manual read of the full PDF is recommended before relying on the numeric results.

---

## Paper 3: EEG based real time classification of consecutive two eye blinks for brain computer interface applications

1. **Paper title**: "EEG based real time classification of consecutive two eye blinks for brain computer interface applications"
2. **Authors**: Masud Rabbani, Nafi Us Sabbir Sabith, Anubhav Parida, Iysa Iqbal, Sayed Mashroor Mamun, Rumi Ahmed Khan, Farhad Ahmed, Sheikh Iqbal Ahamed
3. **Publication year**: 2025
4. **Journal/conference**: Scientific Reports
5. **DOI / URL**: DOI [10.1038/s41598-025-07205-0](https://doi.org/10.1038/s41598-025-07205-0); also available at https://pmc.ncbi.nlm.nih.gov/articles/PMC12217743/
6. **Acquisition hardware**: OpenBCI Ultracortex "Mark IV" 8-channel EEG headset
7. **Sampling rate**: NOT VERIFIED — the paper's own Methods section does not state the sampling rate used for their data collection (a 512 Hz figure surfaced in initial extraction but was traced back to a **cited related work**, not this paper's own acquisition — confirmed on a second, targeted re-read of the Methods text)
8. **Electrodes/channels**: 8-channel headset; analysis restricted to two frontal channels, Fp1 (channel 1) and Fp2 (channel 2)
9. **Preprocessing**: Data checked for missing values/outliers (none found); channel selection justified by prefrontal cortex proximity to eye-blink-generating muscles; no data augmentation/cleaning steps beyond this were confirmed
10. **High-pass cutoff**: NOT VERIFIED — the paper's own Methods section does not state a band-pass filter used on their own data (a "0.5–15 Hz" figure appeared in initial extraction but, like the sampling rate, traced to related/cited work rather than this paper's own preprocessing — confirmed NOT VERIFIED on re-check)
11. **Low-pass cutoff**: NOT VERIFIED (same caveat as above)
12. **Notch filtering**: NOT VERIFIED — not specified in the Methods section
13. **Filter type and order**: NOT VERIFIED
14. **Thresholding method**: NOT explicitly a threshold-based approach — detection is framed as a supervised classification problem (see classifiers below) rather than fixed-threshold peak detection
15. **Blink features**: Signal width (duration) of the raw EEG waveform — reported as "notably larger" for consecutive/double blinks than single blinks — plus statistical and amplitude-derived features distinguishing no-blink / single-blink / consecutive-blink classes
16. **Temporal detection method**: Frame/window-based classification, including an object-detection-style approach (YOLOv8 applied to spectrogram/waveform-image representations) in addition to classical tabular-feature classifiers
17. **Artifact rejection**: Data manually checked for missing values/outliers only (none found); no formal statistical artifact-rejection pipeline (e.g., ICA, amplitude clipping) was confirmed
18. **Classifier if any**: Multiple classifiers compared — XGBoost, SVM (RBF kernel), a Neural Network, and YOLOv8
19. **Reported latency**: NOT VERIFIED — no real-time processing-time/latency figure was found in the Methods/Results text
20. **Reported accuracy/sensitivity/specificity/precision**: XGBoost 88.89% accuracy (channel 1 & 2 evaluated separately; accuracy dropped substantially, by the paper's own report, when channels were combined); SVM and the Neural Network reached up to 89.0% accuracy on channel-2 data (also degraded when channels combined); YOLOv8 achieved 95.39% precision, 98.67% recall, and mAP50 of 99.5% — the strongest result in the paper. Ten healthy participants (5 male, 5 female, ages 20–35) contributed 885,600 total EEG data points across three sessions each.
21. **What we should borrow (synthesis)**: This is the paper most directly on point for our exact target discrimination task — no-blink vs. single-blink vs. double/consecutive-blink — and confirms that blink *duration/width* is a strong, simple discriminating feature between single and double blinks, which is promising for a lightweight (non-deep-learning) embedded classifier rather than requiring YOLOv8-scale compute.
22. **What we should NOT borrow (synthesis)**: Do not port the YOLOv8 image-based pipeline to an ESP32 — it is far too heavy for embedded deployment and its strong performance was on a still-small, single-population dataset (10 subjects) using an 8-channel research-grade OpenBCI cap, not a 2–4 channel consumer Muse 2. The accuracy drop when combining channels 1 and 2 is a useful cautionary data point: naively stacking multiple frontal channels did not help their classical classifiers, so we should test single-vs-multi-channel choices empirically rather than assuming more channels helps.
23. **Applicability to Muse 2 + ESP32 (synthesis)**: Moderate. The classification framing (3-class: none/single/double) maps directly onto our control scheme, but the hardware (OpenBCI Mark IV, 8-channel, presumably higher sample rate) and best-performing model (YOLOv8) are not embedded-friendly. Best used as validation that duration/width-based features can separate single vs. double blinks, informing our own feature engineering rather than supplying a ready-to-port model.

---

## Paper 4: A Hardware-Based Configurable Algorithm for Eye Blink Signal Detection Using a Single-Channel BCI Headset

1. **Paper title**: "A Hardware-Based Configurable Algorithm for Eye Blink Signal Detection Using a Single-Channel BCI Headset"
2. **Authors**: Rafael López-Ahumada, Raúl Jiménez-Naharro, Fernando Gómez-Bravo
3. **Publication year**: 2023
4. **Journal/conference**: Sensors (MDPI), vol. 23, article/issue 11
5. **DOI / URL**: DOI [10.3390/s23115339](https://doi.org/10.3390/s23115339); also https://pmc.ncbi.nlm.nih.gov/articles/PMC10255990/ and https://www.mdpi.com/1424-8220/23/11/5339
6. **Acquisition hardware**: NeuroSky MindWave™ single-channel BCI headset, data transferred to the processing board via an HC-05 Bluetooth module
7. **Sampling rate**: 512 Hz
8. **Electrodes/channels**: 1 (single frontal EEG channel)
9. **Preprocessing**: Signal passed through a hardware-implemented differentiator (shift-register-based approximation of a derivative operator, parameterized by p = 64 samples) prior to peak/threshold logic
10. **High-pass cutoff**: NOT VERIFIED as an explicit Hz figure — described only as an effect implicit in the differentiator structure, not a classical filter specification
11. **Low-pass cutoff**: Effective cutoff below 4 Hz achieved via the differentiator configuration (p = 64) — reported as an approximate/derived figure, not a designed analog/digital filter with a stated stopband
12. **Notch filtering**: NOT VERIFIED — not explicitly mentioned
13. **Filter type and order**: Custom differentiator ("shift register" discrete approximation of a derivative), not a standard Butterworth/Chebyshev design; explicit order not given beyond the p = 64 tap parameter
14. **Thresholding method**: Dual-threshold scheme — a positive threshold (threshold+) applied to maxima and a negative threshold (threshold−) applied to minima of the differentiated signal
15. **Blink features**: Peak-to-peak amplitude and the maximum/minimum values of the differentiated signal
16. **Temporal detection method**: The algorithm searches for a maximum value sustained across a defined number of consecutive samples, i.e., a persistence/dwell-time criterion layered on top of the amplitude thresholds
17. **Artifact rejection**: "Rebound filtering" via dual-slope analysis to reject secondary bounce artifacts following a true blink peak
18. **Classifier if any**: None — deterministic threshold/logic-based detection, implemented directly in hardware description language
19. **Reported latency**: The FPGA implementation required approximately 19.5 fewer samples (≈6.39 ms faster) than the manufacturer's NeuroSky proprietary software to flag a detection
20. **Reported accuracy/sensitivity/specificity/precision**: ~5% error rate (1 of 20 test artifacts undetected); no data loss reported for the FPGA implementation, versus data loss observed in the Arduino and stock NeuroSky software comparison implementations
21. **What we should borrow (synthesis)**: This paper is the strongest available reference for actually moving a blink detector into embedded/real-time hardware rather than offline MATLAB/Python — its differentiate → dual-threshold → persistence-check → rebound-rejection pipeline is a template we could adapt directly for ESP32 firmware (even without an FPGA, the same logical stages translate to fixed-point C). The explicit benchmarking against a software baseline (and reporting a millisecond-scale latency win) is a useful methodology template for how we should benchmark our own ESP32 port.
22. **What we should NOT borrow (synthesis)**: Their target device (NeuroSky MindWave) uses a different analog front-end/gain chain than the Muse 2, so absolute threshold values are not transferable as-is. The FPGA (Artix-7/VHDL) implementation path is not what we are targeting (ESP32/C or MicroPython) — treat this as an architectural/algorithmic reference, not a code-reuse source. Their validation set is very small (20 artifacts), so the ~5% error figure should not be treated as a robust accuracy estimate.
23. **Applicability to Muse 2 + ESP32 (synthesis)**: High for pipeline design (single-channel, low-latency, deterministic, embedded-hardware-proven), moderate for numeric parameter reuse (different headset/amplifier). Good evidence that a fully deterministic (non-ML) approach can be both fast and implementable on resource-constrained hardware, supporting a similar first-pass design choice for our ESP32 port before considering an on-device classifier.

---

## Paper 5: EEG blink and gaze control using random forest classification for accessible assistive robotic navigation in real world conditions

1. **Paper title**: "EEG blink and gaze control using random forest classification for accessible assistive robotic navigation in real world conditions"
2. **Authors**: Mouad Nechchad, Badr Elkari, Imane El Midaoui, Shadia Ait El Cadi, Zineb M'Hifed, Loubna Ourabah, Abebaw Degu Workneh, Yassine Chaibi, Shaik Mohammad Irshad, Z. M. S. El-Barbary, Mourad Yessef
3. **Publication year**: 2026
4. **Journal/conference**: Scientific Reports
5. **DOI / URL**: DOI [10.1038/s41598-026-56416-6](https://doi.org/10.1038/s41598-026-56416-6); PubMed listing https://pubmed.ncbi.nlm.nih.gov/42288545/
6. **Acquisition hardware**: NOT VERIFIED — the accessible abstract/preview text did not specify the EEG headset model or amplifier
7. **Sampling rate**: NOT VERIFIED
8. **Electrodes/channels**: NOT VERIFIED (number of electrodes/channels not stated in accessible text)
9. **Preprocessing**: NOT VERIFIED in detail
10. **High-pass cutoff**: NOT VERIFIED
11. **Low-pass cutoff**: NOT VERIFIED
12. **Notch filtering**: NOT VERIFIED
13. **Filter type and order**: NOT VERIFIED
14. **Thresholding method**: NOT VERIFIED — detection framed as a supervised classification task rather than a described fixed-threshold rule
15. **Blink features**: "Blink- and gaze-related EEG features" extracted for classification — specific feature list NOT VERIFIED from accessible text
16. **Temporal detection method**: NOT VERIFIED
17. **Artifact rejection**: NOT VERIFIED
18. **Classifier if any**: Random forest (explicitly reported as the best-performing of the models they compared)
19. **Reported latency**: The paper explicitly states end-to-end system latency was **not quantitatively benchmarked**, and lists this as a stated limitation of their own study
20. **Reported accuracy/sensitivity/specificity/precision**: 98.74% ± 1.19% accuracy, 0.9874 macro-F1, 0.9993 macro-AUC, across a stated 15-participant multi-subject dataset, for a 5-class ocular-control-command scheme
21. **What we should borrow (synthesis)**: The overall system concept — mapping a small set of discrete ocular EEG events (blinks, sustained gaze/other ocular activity) to a small set of discrete control commands, wirelessly relayed to an embedded controller (they used a Raspberry Pi to drive wheelchair-type robot navigation) — is architecturally almost identical to what we want: Muse 2 → wireless link → ESP32 → discrete prosthetic-hand commands (e.g., single blink = grip, double blink = release). Their explicit call-out that they did *not* benchmark end-to-end latency is a useful reminder that we must budget for and measure this ourselves, since classification accuracy alone does not guarantee a usable real-time control loop.
22. **What we should NOT borrow (synthesis)**: Because most of the signal-processing detail (hardware, sampling rate, filtering, feature list) could not be verified from the accessible text, we should not assume their preprocessing pipeline is compatible with or superior to what we design ourselves — this paper should be cited only for its high-level architecture and reported classification performance, not for concrete filter/threshold parameters. Given it is a very recently published paper (2026) discovered via a single search pass, we recommend a follow-up manual full-text read (via institutional access) before leaning on its accuracy numbers for any design decision beyond "random forest is a reasonable classifier choice for this class of problem."
23. **Applicability to Muse 2 + ESP32 (synthesis)**: High at the systems/architecture level (discrete ocular EEG events → wireless-relayed discrete actuator commands is exactly our use case, and a Raspberry-Pi-class embedded target is a reasonable proxy for feasibility on an ESP32-class device for a random-forest-sized model), but low at the parameter level since acquisition/filtering details are unverified. Its own acknowledged gap — no end-to-end latency benchmark — is directly relevant to us: our project should explicitly measure and report blink-to-actuation latency, which this otherwise-strong reference paper did not.

---

## Synthesis — recommended starting parameters

**These are starting points for our own experimentation, not settled values** — several are engineering judgment calls (explicitly flagged) because most of the surveyed papers either did not report full filter specs or those specs (from different headsets) do not directly transfer to the Muse 2's front-end.

- **High-pass cutoff**: Start around **0.5–1 Hz** to remove DC drift/baseline wander while preserving the low-frequency energy of the blink waveform (blinks are slow, high-amplitude deflections, not high-frequency content). *This is an engineering judgment call* — none of the 5 papers gave a primary-source-verified high-pass value we can cite directly (Paper 3's "0.5–15 Hz" band-pass figure traced back to a cited paper, not to their own methods, so it is not usable as a direct citation; Paper 4 only implies a differentiator-based low-frequency rolloff without a clean stopband spec).
- **Low-pass cutoff**: Start around **8–15 Hz**, informed loosely by Paper 4's differentiator producing an effective sub-4 Hz emphasis for a fast slope-based detector, and by the general shape of blink waveforms (energy concentrated below ~10–15 Hz, well below alpha/beta EEG bands). *This is primarily an engineering judgment call*, cross-checked only loosely against Paper 4 (10.3390/s23115339) — treat as a hypothesis to validate against our own recorded Muse 2 blink waveforms, not a literature-derived constant.
- **Notch filtering**: None of the 5 papers verifiably reported using a mains-notch filter (all fields were NOT VERIFIED or absent for this item across every paper). *Engineering judgment*: include a 50/60 Hz notch (matching local mains frequency) as standard EEG hygiene regardless, since consumer dry-electrode headbands like the Muse 2 are typically more susceptible to mains interference than research-grade wet-electrode caps (Paper 1 (Shachar et al., 10.1109/SPMB55497.2022.10014708) is itself Muse-based and reports no notch filter, which may explain part of its need for empirically-tuned absolute-µV thresholds).
- **Detection approach — Stage 1 (single vs. no blink)**: Adopt a deterministic time-domain state machine modeled directly on Paper 1 (MED, 10.1109/SPMB55497.2022.10014708): light smoothing (exponential + moving-average filter cascade), minima detection with a minimum inter-peak spacing (~0.1 s) and minimum amplitude-below-baseline threshold, followed by a matching-maximum search and baseline-crossing boundary definition. This is the only paper in our set that is both Muse-hardware-specific and fully deterministic (no training data needed), making it the most practical first implementation target for the ESP32 port.
- **Detection approach — Stage 2 (single vs. double/fast-double blink)**: Use blink **duration/width** and **inter-blink interval** as the primary discriminating features, following the finding in Paper 3 (Rabbani et al., 10.1038/s41598-025-07205-0) that consecutive/double blinks produce a measurably wider waveform than single blinks — but implement this as a lightweight rule/threshold or small classical classifier (not their heavyweight YOLOv8 model, which is not ESP32-appropriate).
- **Real-time architecture**: Favor a short sliding-window feature-extraction step (following Paper 2, RT-Blink, 10.1109/JSEN.2022.3232176 — 60 ms windows, ~5 ms compute budget per window in their setup) feeding either the deterministic state machine (Stage 1) or a small model, rather than batch/offline processing — this keeps the design compatible with eventual ESP32 deployment.
- **Artifact handling**: Combine Paper 1's baseline-crossing/partial-blink rejection with Paper 4's (10.3390/s23115339) "rebound filtering" concept (rejecting secondary bounce peaks immediately following a true detection) to reduce double-counting a single blink as two events — important for keeping single-blink and double-blink classes cleanly separated.
- **System-level latency budget**: Explicitly measure end-to-end blink-to-actuation latency during bench testing. Paper 5 (Nechchad et al., 10.1038/s41598-026-56416-6) achieved high classification accuracy (98.74%) in an architecturally similar discrete-ocular-command-to-embedded-actuator system but explicitly did **not** benchmark end-to-end latency — we should not repeat that gap, since a prosthetic-hand control loop has real usability requirements around response time that pure classification accuracy does not capture.
- **Sampling rate**: Use whatever native EEG sampling rate the Muse 2 SDK exposes (commonly reported as 256 Hz for Muse 2 in third-party documentation, though this was not independently re-verified against Muse's own current spec sheet during this literature pass and should be confirmed against the Muse 2 developer documentation directly) rather than trying to match any single paper's rate (220 Hz in Paper 1, 512 Hz in Paper 4) — window lengths (e.g., the 60 ms window from Paper 2, or the 0.1 s / 0.01 s constants from Paper 1) should be re-derived in samples for our actual sampling rate rather than copied as sample counts.

### Where NOT VERIFIED dominated
Across the 5 papers, the fields most often reduced to **NOT VERIFIED** were: **notch filtering** (all 5 papers), **explicit high-pass/low-pass Hz cutoffs as classically specified filters** (4 of 5 papers — only Paper 4 gave even an approximate derived cutoff), and **reported end-to-end latency** (3 of 5 papers gave no usable latency figure, and Paper 5 explicitly flagged this as its own limitation). This is exactly where our own bench experimentation with the Muse 2 and ESP32 will need to fill the gap: we should plan to empirically sweep filter cutoffs against our own recorded blink data, decide on our own notch strategy rather than copying one from the literature, and build our own latency instrumentation from the outset rather than assuming it can be retrofitted.
