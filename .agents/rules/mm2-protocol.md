# MicroMonsta 2 Hardware & Protocol Specifications

- **SysEx Preset Size:** Official MM2 sound program dumps are strictly **216 bytes** long.
- **Single-Layer Scope:** SysEx dumps represent a single sound layer (Layer A or Layer B). Command byte `0x01` is Layer A; `0x02` is Layer B.
- **Hardware Limitations (Do Not Attempt Over MIDI):**
  - **Combination Settings:** Combination definitions (Split vs. Stack mode, split point note, layer mix/balance, transpose, performance controller assignments) cannot be read, edited, or backed up over MIDI. While MIDI Program Change (0–99) selects stored combi presets, combi configuration is hardware-only via the synth screen and encoders.
  - **System Settings:** Master tuning, base MIDI channel, screen timeout, and hardware button timings are inaccessible over SysEx or MIDI.
- **Timbral Modes:** The synth operates in Monotimbral, Bitimbral, or Combi mode. The editor detects the active mode by probing Layer B, but switching modes is hardware-only; the UI mode indicator is display-only.
- **NRPN Control:** High-resolution parameters use 14-bit NRPN (MSB CC 99, LSB CC 98, Data MSB CC 6, Data LSB CC 38); 7-bit parameters use CC 6 only.
