# Benchmarks

## Overview

Two metrics are measured across the Baseline (blocking UI) and Experimental Configuration (background processing) setups:

- **Metric 1:** how long the UI blocks when the user clicks Apply and navigates away to another project during processing.
- **Metric 2:** whether the progress indicator and Cancel control reappear after an F5 reload, and how long recovery takes.

## Prerequisites

- PictuRAS stack running at `https://localhost:8080` (default).
- Registered test account. Use a **Premium account** to avoid daily operation quotas and video duration limits.
- Two projects in the sidebar: a primary project with a test video (e.g. `teste`) and a secondary project for navigation (e.g. `teste vazio`).
- Add a tool to the test video (for example, **Speed** at **2.75x**) and save it in the pipeline. Do **not** click Apply.
- First-time Playwright setup in this directory: `npm install` and `npx playwright install chromium`.

## Configuration Variables

Edit these constants at the top of the `.spec.js` files or pass them inline as environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_URL` | `https://localhost:8080` | Application URL. |
| `USER_EMAIL` | `ola@example.com` | Login email. |
| `USER_PASSWORD` | `ola12345` | Login password. |
| `PROJECT_ID` | `` (empty) | Primary project ID; falls back to `PROJECT_NAME` or the first sidebar project. |
| `PROJECT_NAME` | `teste` | Primary project name in the sidebar. |
| `OTHER_PROJECT_NAME` | `teste vazio` | Secondary project for Metric 1 navigation (experimental spec only). |

## How to Run & Results

```bash
npx playwright test usability_baseline_metric1.spec.js usability_baseline_metric2.spec.js
npx playwright test usability_experimental_configuration_metric1.spec.js usability_experimental_configuration_metric2.spec.js
```

Inline environment variables:

```bash
USER_EMAIL=test@example.com USER_PASSWORD=secret PROJECT_NAME=teste \
OTHER_PROJECT_NAME="teste vazio" \
npx playwright test usability_experimental_configuration_metric1.spec.js
```

CSV files are saved in `benchmarks/` and overwritten after every iteration:

| File | Columns |
| --- | --- |
| `results_baseline_metric1.csv` | `iteration,metric1_ui_blocking_ms,total_processing_ms` |
| `results_baseline_metric2.csv` | `iteration,metric2_recovered,metric2_recovery_time_ms` |
| `results_experimental_configuration_metric1.csv` | `iteration,metric1_ui_blocking_ms,total_processing_ms` |
| `results_experimental_configuration_metric2.csv` | `iteration,metric2_recovered,metric2_recovery_time_ms` |

`metric2_recovered` is `1` when recovery succeeds, `0` otherwise; recovery time is in milliseconds. The current baseline specs actually write `results_baseline_metric1_1.csv` and `results_baseline_metric2_1.csv`.
