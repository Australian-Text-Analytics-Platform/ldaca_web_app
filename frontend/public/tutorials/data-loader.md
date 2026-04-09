<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-data-loader-section">Data Loader</h1>

The Data Loader is the entry point of the application and must be configured before any analysis can be performed. It comprises three main panels: the active workspace panel, the workspace manager, and the files and uploads section.

![Data loader screenshot](tutorials/assets/data_loader.png)

<h2 id="help-data-loader-active-workspace">Active workspace overview</h2>

![Active workspace screenshot](tutorials/assets/data_loader/active_workspace.png)

The active workspace panel displays the currently loaded project along with its associated data blocks. From this panel, you can rename or unload the active workspace. When no workspace is loaded, this panel also provides the option to create a new, empty workspace.

- Verify that the correct project is loaded before proceeding with analysis.
- Create, rename, or unload a workspace as needed.

<h2 id="help-data-loader-create-workspace-name">Workspace name input</h2>

![Create workspace screenshot](tutorials/assets/data_loader/create_workspace.png)

This panel is visible only when no workspace is currently active. Use it to specify a name for a **new** empty workspace. Choose a descriptive name that reflects the project or dataset (e.g., the project title or dataset identifier). An optional description can also be provided at this stage.

> **Note:** The workspace description cannot be edited within the application after the workspace has been created.

**Q: What happens if I reuse a workspace name?**

Workspace names are not unique identifiers within the system — the application permits multiple workspaces to share the same name, each stored in a distinct directory on the file system. However, using identical names for different workspaces is strongly discouraged, as it can lead to confusion when managing or revisiting projects. If duplicate names are already present, it is recommended to activate each affected workspace in turn, review its contents, and rename it to a distinct and meaningful label to prevent future ambiguity.

<h2 id="help-data-loader-create-workspace-button">Create workspace button</h2>

Clicking this button creates a new workspace with the specified name and optional description.

- The newly created workspace becomes the active workspace immediately.
- An active workspace is required before files can be loaded and analysed.

<h2 id="help-data-loader-rename-workspace-input">Rename workspace input</h2>

Use this field to rename the **currently active** workspace. Renaming is useful when the project scope evolves or when you wish to maintain a more organised workspace list. The workspace description can also be updated from this field.

<h2 id="help-data-loader-unload-button">Unload workspace</h2>

The unload action closes the active workspace without deleting it.

- Use this to switch between projects.
- The unloaded workspace remains accessible in the workspace manager.

<h2 id="help-data-loader-workspace-manager">Workspace manager overview</h2>

![Workspace manager screenshot](tutorials/assets/data_loader/workspace_manager.png)

The workspace manager lists all saved workspaces, enabling you to switch between projects and maintain an organised workspace inventory.

- Click **Activate** to set a workspace as the active project; the active workspace is visually highlighted.
- Review the last modified timestamp and data block count to confirm you are loading the intended workspace.
- Use **Delete** to permanently remove a workspace that is no longer required.

<h2 id="help-data-loader-files-section">Files and uploads section</h2>

![Files section screenshot](tutorials/assets/data_loader/files_section.png)

This panel is used to bring data into the application. It supports file uploads, sample data imports, and add-to-workspace operations. You can also create subfolder structures, reorganise files via drag-and-drop, and remove files that are no longer needed.

**Q: What file formats are supported?**

The application supports common text and tabular formats, including CSV and Excel. If a file fails to load, verify its character encoding and delimiter settings.

<h2 id="help-data-loader-upload-button">Upload file</h2>

Click this button to upload a file from your local machine.

- The following file formats are supported for text and metadata:
  - Plain text (.txt, .md, .xml)
  - Delimited tabular text (.csv, .tsv, .xlsx)
  - Columnar tabular format (.parquet)
  - ZIP-archived collections of plain text files
- Supported file types can be previewed before being added to the workspace as a data block.

<h2 id="help-data-loader-import-sample-button">Import sample data</h2>

Use this option to load curated sample datasets for exploration and testing.

- A selection of sample datasets is bundled with the application.
- These datasets are intended for first-time users to become familiar with the application's capabilities.
- All sample data is publicly available and may be freely tested or removed.
- If sample data is used to generate a research output, please cite <img alt="citemark" src="tutorials/assets/citemark.png" style="display: inline; height: 1em; vertical-align: middle;"> the dataset appropriately.

<h2 id="help-data-loader-import-ldaca-button">Import from LDaCA</h2>

Use this option to import a dataset directly from the Language Data Commons of Australia (LDaCA).

![Copy download link](tutorials/assets/data_loader/ldaca_loader_link.png)

- Paste the full URL of an LDaCA ZIP download (e.g., as obtained from an LDaCA repository page by tight clicking the download icon, then paste the link to the url input of the pop up window).

![Paste download link](tutorials/assets/data_loader/ldaca_loader_input.png)

- The import process runs in the background, depending on the size of the collection and your network speed, this may take from 30 seconds to a few minutes to finish.
- Imported collection will appear in the files list under the **LDaCA** folder as a *parquet* file after the extraction completes. If the files do not appear, click the refresh button in the top-right corner of the panel.
- Currently, this importer supports the following fully public collections: [COOEE](https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.26180~23961609&_crateId=arcp%3A%2F%2Fname%2Chdl10.26180~23961609), [ICE-AUS](https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.25949~24769173.v1&_crateId=arcp%3A%2F%2Fname%2Chdl10.25949~24769173.v1), and [La Trobe Australian Spoken English](https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.26181~23089559&_crateId=arcp%3A%2F%2Fname%2Chdl10.26181~23089559).


<h2 id="help-data-loader-file-operations">File operations</h2>

![Files operations](tutorials/assets/data_loader/file_operations.png)

Once files have been uploaded, imported, or downloaded, the following actions are available:

- Preview the file contents prior to adding it to the workspace;
- Add the selected file to the active workspace as a data block;
- Download the original file to your local machine;
- Remove the file from the application;
- Create subfolders and reorganise files using drag-and-drop.

## Practice exercise

1. Create a workspace named **"Practice Corpus"**.
2. Upload a CSV file and preview its contents.
3. Add the file to the workspace graph as a data block.
4. Rename the workspace to **"Practice Corpus v1"**.

[← Back to tutorial index](./index.md)
