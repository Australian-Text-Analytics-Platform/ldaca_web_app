<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-data-loader-section">Data loader</h1>

This is the landing page of the whole webApp before any analysis can be done. There are three main components here, in which you can create/modify an active workspace, load an existing workspace or bring text and metadata files to the system respectively.  

![Data loader screenshot](tutorials/assets/data_loader.png)

<h2 id="help-data-loader-active-workspace">Active workspace overview</h2>

![Active workspace screenshot](tutorials/assets/data_loader_active_workspace.png)

The active workspace shows the current project and data blocks under analysis. The user can rename or unload the current workspace. If there is no active workspace loaded, the user can also initiate a new empty workspace from here.

- Use it to confirm you are in the right project.
- Use it to create, rename or unload a workspace.

<h2 id="help-data-loader-create-workspace-name">Workspace name input</h2>

![Create workspace screenshot](tutorials/assets/data_loader_create_workspace.png)

This pane only appears when there isn't an active workspace loaded. Use this pane  to initialise the name of a **new** empty workspace. Pick something descriptive (e.g., the project or dataset name) and add optional description to this workspace.
- Caveat: the description can not be changed within the webApp after creation.

**Q: What happens if I reuse a name?**

Please don't! This will confuse yourself and potentially lead to mistakes in the future. The webApp allows the same name being reused for multiple workspaces, as the name itself is not a unique identifier for the program. New folder will be created in the file system in different names, but for the user, using same name for different versions of analysis can be very tricky. Please try to make new names that are meaningful and distinguishable to the future yourself. If this happened, we suggest the user to load each workspace with identical names, examine the contents then rename them accordingly to avoid future confusions.

<h2 id="help-data-loader-create-workspace-button">Create workspace button</h2>

This button creates a new workspace using the name you entered.

- After creating, the workspace becomes active.
- An active workspace is needed before loading any files.

<h2 id="help-data-loader-rename-workspace-input">Rename workspace input</h2>

Use this field to rename the **current** active workspace. Rename is helpful when the project scope changes or you want to tidy your list. You can also update the workspace description here.

<h2 id="help-data-loader-unload-button">Unload workspace</h2>

Unload closes the active workspace without deleting it.

- Use this when you want to switch projects.
- Your workspace remains available in the list.

<h2 id="help-data-loader-workspace-manager">Workspace manager overview</h2>

![Workspace manager screenshot](tutorials/assets/data_loader_workspace_manager.png)

The workspace manager lists every saved workspace so you can switch projects and keep your workspace list tidy.

- Click **Activate** to make a workspace current (the active one is highlighted).
- Review the updated time and data block count to confirm you are opening the right workspace.
- Use **Delete** to permanently remove a workspace you no longer need.

<h2 id="help-data-loader-files-section">Files and uploads section</h2>

![Files section screenshot](tutorials/assets/data_loader_files_section.png)

This panel is where you bring new data into your workspace. It includes upload, sample import, and add-to-workspace actions.

**Q: What file types are supported?**

Common formats like CSV and Excel are supported. If your file fails to load, check encoding and delimiters.

<h2 id="help-data-loader-upload-button">Upload file</h2>

Click this to upload a local file from your computer.

- The app supports to load text and metadata from the following file formats:
  - plain text (.txt, .md, .xml)
  - tabular text (.csv, .tsv, .xlsx)
  - other tabular (.parquet)
  - zip archived plain text files
- Supported file types can be previewed before loading as a data block.

<h2 id="help-data-loader-import-sample-button">Import sample data</h2>

Use this to load curated sample datasets for quick experimentation.

- Some sample datasets are shipped with the app for exploration and testing.
- These are great for first-time users to try and familiar with the app.
- These data are publicly available and safe to test and delete.
- Please cite <img alt="citemark" src="tutorials/assets/citemark.png" style="display: inline; height: 1em; vertical-align: middle;"> the dataset if they are used for generating a research outcome.

<h2 id="help-data-loader-import-ldaca-button">Import from LDaCA</h2>

Click this to import a dataset directly from the Language Data Commons of Australia (LDaCA).

- Paste the full URL to an LDaCA Zip download (e.g., from an LDaCA repository page).
- The import runs in the background.
- Files will appear in your files list once the download and extraction are complete.

<h2 id="help-data-loader-add-button">Add file to workspace</h2>

This action adds the selected file into the workspace graph as a data block.

- After adding, you can run analyses on it.
- Use descriptive data block names for clarity.

## Practice exercise

1. Create a workspace called **“Practice Corpus”**.
2. Upload a CSV file and preview it.
3. Add the file to the workspace graph.
4. Rename the workspace to **“Practice Corpus v1”**.

[← Back to tutorial index](./index.md)
