# Canonical Cutover Record

- Repository: `LPolaris-1/kaoyan-math-review`
- Previous `main`: `4fef116adafe6081d0cb114c50c2000134faf4ed`
- Migration commit: `99258e70f4072617dedf1bd458d3d6fe492fd6c2`
- New `main`: `99258e70f4072617dedf1bd458d3d6fe492fd6c2`
- Cutover date: `2026-08-27` (Asia/Shanghai)
- Canonical data: 164 questions / 30 dates
- Current production release: `20260826-122638` (161 questions / 29 dates), still running
- Production deployment: pending; no production server or database was changed by this cutover

Source cutover is complete: GitHub `main` is now the source of truth for future development and deployment. Production cutover remains a separate, explicitly authorized operation.

The migration branch remains available for audit until the first canonical production deployment succeeds.
