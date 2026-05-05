<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-export-section">Export tutorial</h1>

![Export screenshot](tutorials/assets/export.png)

Export lets you download one or more data blocks from your workspace as files for offline analysis, sharing, or archiving. You can export individual data blocks one at a time or bundle all selected blocks into a single ZIP archive.

<h2 id="help-export-parameters">Parameter panel</h2>

<h3 id="help-export-data-blocks">Step 1 — Select your data</h3>

Select one or more data blocks in the workspace. All selected blocks appear in the export list, showing each block's name, ID, and dimensions (rows × columns).

<h3 id="help-export-format">Step 2 — Choose a format</h3>

Use the **Format** dropdown to choose the output file format:

| Format | Extension | Best used for |
|---|---|---|
| CSV | .csv | Maximum compatibility; opens in any spreadsheet or text editor |
| Excel | .xlsx | Formatted output; useful when sharing with non-technical users |
| JSON | .json | Hierarchical or nested data; web and API workflows |
| NDJSON | .ndjson | Streaming JSON; one JSON object per line |
| Parquet | .parquet | Efficient columnar storage; best for large datasets or re-importing into the app |
| Arrow IPC | .arrow | High-performance binary format for data pipeline use |

The same format applies to all blocks in a bundle export.

<h2 id="help-export-results">Step 3 — Download</h2>

<h3 id="help-export-run">Individual download</h3>

Click the **Download** button next to any data block in the list to download that block as a single file in the chosen format. Each block is downloaded separately.

<h3 id="help-export-bundle">Export All</h3>

Click **Export All** to download all selected data blocks as a ZIP archive. Each data block becomes one file inside the archive, named after the data block. Use this to export your entire workspace in one step.

<h2 id="help-export-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| Download button does nothing | Browser blocked the download | Check browser download permissions or pop-up blocker settings |
| File opens with garbled characters | Character encoding mismatch | Re-open the CSV in your tool and specify UTF-8 encoding |
| Excel shows all data in one column | Delimiter not recognised | Open as CSV and specify comma as the delimiter |
| Parquet file unreadable | Tool does not support Parquet | Use pandas, DuckDB, or re-import into this app instead |

<h2 id="help-export-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Format | CSV | Change to match your downstream tool |

## Practice exercise

1. Select two data blocks in the workspace.
2. Set the format to **CSV** and download each block individually.
3. Open one CSV file and confirm the columns match the Data Viewer.
4. Switch the format to **Parquet** and use **Export All** to download both blocks as a ZIP archive.

[← Back to tutorial index](./index.md)
