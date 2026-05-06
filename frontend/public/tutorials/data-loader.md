<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-data-loader-section">Data Loader tutorial</h1>

The Data Loader is the entry point of the application and must be configured before any analysis can be performed. It comprises three main panels: the active workspace panel, the workspace manager, and the files and uploads section.

![Data loader screenshot](tutorials/assets/data_loader.png)

<h2 id="help-data-loader-active-workspace">Active workspace overview</h2>

![Active workspace screenshot](tutorials/assets/data_loader/active_workspace.png)

The active workspace panel displays the currently loaded project along with its associated data blocks. From here you can rename or unload the active workspace. When no workspace is loaded, this panel also shows the option to create a new, empty workspace.

- Verify the correct project is loaded before starting any analysis.
- Create, rename, or unload a workspace as needed.

<h2 id="help-data-loader-create-workspace-name">Workspace name input</h2>

![Create workspace screenshot](tutorials/assets/data_loader/create_workspace.png)

This field is visible only when no workspace is currently active. Use it to specify a name for a new empty workspace. Choose a descriptive name that reflects the project or dataset (e.g. the project title or dataset identifier). An optional description can also be provided at this stage.

Workspace names are not unique identifiers — the application allows multiple workspaces to share the same name, each stored in a separate directory. Using identical names for different workspaces is strongly discouraged, as it can cause confusion when managing or revisiting projects.

<h2 id="help-data-loader-create-workspace-button">Create workspace button</h2>

Clicking this button creates a new workspace with the specified name and optional description.

- The newly created workspace becomes the active workspace immediately.
- **An active workspace is required before files can be loaded and analysed.**

<h2 id="help-data-loader-rename-workspace-input">Rename workspace input</h2>

Use this field to rename the currently active workspace. Renaming is useful when the project scope evolves or when you want a more organised workspace list. The workspace description can also be updated from this field.

<h2 id="help-data-loader-unload-button">Unload workspace</h2>

The unload action closes the active workspace without deleting it.

- Use this to switch between projects.
- The unloaded workspace remains accessible in the workspace manager.

<h2 id="help-data-loader-workspace-manager">Workspace manager overview</h2>

![Workspace manager screenshot](tutorials/assets/data_loader/workspace_manager.png)

The workspace manager lists all saved workspaces, enabling you to switch between projects and maintain an organised inventory.

- Click **Activate** to set a workspace as the active project; the active workspace is visually highlighted.
- Review the last-modified timestamp and data-block count to confirm you are loading the intended workspace.
- Click **Download** to export the entire workspace as a ZIP archive. The archive contains all data blocks and workspace metadata. Data blocks are stored in [Parquet](https://parquet.apache.org/) format — a compressed, column-oriented binary format that preserves data types exactly and is far more compact than CSV. Because Parquet is a well-supported open standard, the downloaded files can also be opened directly in tools such as Python (pandas/polars), R, or DuckDB. The ZIP is saved to your browser's default downloads folder (or your system Downloads folder in the desktop app). You can upload the ZIP to another instance of the application to resume your work there — for example when sharing a project with a collaborator or moving between a local installation and a hosted server.
- Click **Delete** to permanently remove a workspace that is no longer needed.

<h2 id="help-data-loader-files-section">Files and uploads section</h2>

![Files section screenshot](tutorials/assets/data_loader/files_section.png)

This panel is used to bring data into the application. It supports file uploads, sample data imports, LDaCA imports, and add-to-workspace operations. You can also create subfolder structures, reorganise files via drag-and-drop, and remove files that are no longer needed.

<h2 id="help-data-loader-upload-button">Upload file</h2>

Click this button to upload a file from your local machine. Supported formats:

- Plain text: `.txt`, `.md`, `.xml`
- Delimited tabular text: `.csv`, `.tsv`, `.xlsx`
- Columnar tabular format: `.parquet`
- ZIP-archived collections of plain text files

Supported file types can be previewed before being added to the workspace as a data block.

<h2 id="help-data-loader-import-sample-button">Import sample data</h2>

Use this option to load curated sample datasets bundled with the application. These are intended for first-time users to explore the app's capabilities. All sample data is publicly available and may be freely tested or removed. If sample data is used in a research output, please cite <img alt="citemark" src="references/assets/mark_ref.png" style="display: inline; height: 1em; vertical-align: middle;"> the dataset appropriately.

<h2 id="help-data-loader-import-ldaca-button">Import from LDaCA</h2>

Use this option to import a dataset directly from the Language Data Commons of Australia (LDaCA).

![Copy download link](tutorials/assets/data_loader/ldaca_loader_link.png)

1. On the LDaCA repository page, right-click the download icon to copy the ZIP download URL.
2. Paste the URL into the import dialog.

![Paste download link](tutorials/assets/data_loader/ldaca_loader_input.png)

The import runs in the background and may take 30 seconds to a few minutes depending on collection size and network speed. The imported collection appears in the files list under the **LDaCA** folder as a Parquet file once extraction completes. If files do not appear, click the refresh button in the top-right corner of the panel.

Currently supported fully public collections: [COOEE](https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.26180~23961609&_crateId=arcp%3A%2F%2Fname%2Chdl10.26180~23961609), [ICE-AUS](https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.25949~24769173.v1&_crateId=arcp%3A%2F%2Fname%2Chdl10.25949~24769173.v1), and [La Trobe Australian Spoken English](https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.26181~23089559&_crateId=arcp%3A%2F%2Fname%2Chdl10.26181~23089559).

<h2 id="help-data-loader-add-button">Add file to workspace</h2>

![Files operations](tutorials/assets/data_loader/file_operations.png)

Once a file is uploaded, imported, or downloaded, the following actions are available:

- **Preview** the file contents before adding it to the workspace.
- **Add to Workspace** to load the file as a data block in the active workspace.
- **Download** the original file to your local machine.
- **Remove** the file from the application.

<h2 id="help-data-loader-file-organisation">Organising files</h2>

The files panel supports folder management and drag-and-drop reorganisation so you can keep uploads tidy across projects.

**Creating folders**

Click the <kbd>+</kbd> folder icon next to any existing folder to create a subfolder inside it, or use the equivalent button at the root level to create a top-level folder. A dialog will prompt you for a name. Folders can be nested to any depth.

**Deleting files and folders**

Click the trash icon next to any file to remove it permanently. There is no separate delete-folder button — a folder is removed automatically once all files inside it have been deleted.

**Moving files by drag-and-drop**

Drag any file row and drop it onto a target folder (or onto any file inside a target folder) to move the file there. Valid drop targets are highlighted as you drag. A file cannot be moved to the folder it already belongs to, and dropping a file into a folder that already contains a file with the same name is not allowed.

<h2 id="help-data-loader-citation-notice">Citation and licensing notices</h2>

Some folders — particularly those created by the LDaCA importer — display a small quote icon (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:text-bottom"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/></svg>) next to the folder name. This icon indicates that the folder contains a `README.md` file with citation, licensing, or copyright information provided by the dataset's author.

**Click the icon to open the notice.** The contents are rendered as formatted text and may include:

- A required citation or acknowledgement for the dataset.
- Licence terms (e.g. Creative Commons, restricted use).
- Copyright or access conditions.

**If this icon appears on a folder you intend to use in research or publication, review the notice carefully and follow the stated requirements before sharing or publishing your results.**

<h2 id="help-data-loader-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| File fails to load | Unsupported format or encoding | Check that the file is UTF-8 encoded and uses a supported format |
| CSV preview shows all data in one column | Wrong delimiter | Re-export with a comma delimiter, or contact the developer team |
| LDaCA import does not appear | Import still in progress | Wait a moment and click the refresh button |
| Workspace not visible in the manager | Working directory changed | Check the working directory setting at the bottom of the sidebar |
| Duplicate workspace names | Created before uniqueness was enforced | Activate each, review contents, and rename to distinct labels |

<h2 id="help-data-loader-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Working directory | `~/Documents/ldaca` | Changeable via the edit icon at the bottom of the sidebar |

## Practice exercise

1. Create a workspace named **Practice Corpus**.
2. Upload a CSV file and preview its contents.
3. Add the file to the workspace as a data block.
4. Rename the workspace to **Practice Corpus v1**.
5. Unload the workspace and reload it from the workspace manager.

[← Back to tutorial index](./index.md)
