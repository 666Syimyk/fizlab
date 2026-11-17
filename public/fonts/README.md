# Self-hosted interface fonts

Downloaded on 2026-09-20 from the official Google Fonts CSS API and fonts.gstatic.com. Font binaries and the original OFL license files are unmodified.

The CSS declares normal Inter weights 400–800 and Manrope weights 500–800, with Latin, Cyrillic and Cyrillic-ext subsets only. Each family/subset has one declaration and one local WOFF2 file. The original variable binaries retain their full internal weight axes; no conversion or font modification was performed. The official Manrope variable files use the internal family name "Manrope ExtraLight" (weight axis 200–800); the Google Fonts CSS family is "Manrope".

Use `/fonts/fonts.css`. It uses relative local font URLs, `font-display: swap`, and the original Unicode ranges. Other character ranges fall back to the application font stack.

## Official sources

- CSS request: https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=Manrope:wght@500..800&display=swap
- Inter repository: https://github.com/google/fonts/tree/main/ofl/inter
- Manrope repository: https://github.com/google/fonts/tree/main/ofl/manrope

## Files

| File | Bytes | SHA-256 | Official URL |
| --- | ---: | --- | --- |
| inter-v20-cyrillic-ext.woff2 | 25960 | `ca157063339ac4ad418f214f3abfed119b0798ab4d377386ce5c9e5a7a435ebd` | https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2 |
| inter-v20-cyrillic.woff2 | 18748 | `71d5ee93cc1e9f1d520a3a8b66456de18c7879d8df09d57fcd2eaff75fef0075` | https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7SUc.woff2 |
| inter-v20-latin.woff2 | 48256 | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` | https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2 |
| manrope-v20-cyrillic-ext.woff2 | 2552 | `de37de877dc17e4577341fa68bb5cb526b53d54cb29721e674208546a3c7849d` | https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggqxSuXd.woff2 |
| manrope-v20-cyrillic.woff2 | 14500 | `c268b459a9329e59fecf39a17618efd44c71735532048d60b12aab76a8c14914` | https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggOxSuXd.woff2 |
| manrope-v20-latin.woff2 | 24836 | `a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972` | https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSg.woff2 |
| Inter-OFL.txt | 4377 | `5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57` | https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt |
| Manrope-OFL.txt | 4387 | `58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b` | https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt |

Both families are licensed under the SIL Open Font License, Version 1.1. Original notices and license terms are in `Inter-OFL.txt` and `Manrope-OFL.txt`.

Verification used fontTools to read each downloaded WOFF2, confirm its family name, and confirm the requested CSS weights fit its variable weight axis. Binary signatures, unique family/subset declarations, and exclusively local CSS URLs were checked.
