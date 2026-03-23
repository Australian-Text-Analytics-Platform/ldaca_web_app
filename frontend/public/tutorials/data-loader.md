<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-data-loader-section">Data loader tutorial</h1>

Use this page to create or load a workspace and bring files into the system. If you are brand new, start here.

![Data loader screenshot](tutorials/assets/data_loader.png)

## Getting oriented

**Q: What is the data loader for?**

It is the front door for your data. You use it to create or load workspaces, upload files, and add datasets to the workspace graph.

<h2 id="help-data-loader-active-workspace">Active workspace overview</h2>

![Active workspace screenshot](tutorials/assets/data_loader_active_workspace.png)

The active workspace tells you which project you are currently working in. Everything you upload and analyze stays in this workspace until you unload it.

- Use it to confirm you are in the right project.
- Use the rename and save actions to manage versions.

<h2 id="help-data-loader-create-workspace-name">Workspace name input</h2>

This field sets the name of a **new** workspace. Pick something descriptive (e.g., the project or dataset name).

**Q: What happens if I reuse a name?**

A workspace name must be unique. If you reuse a name, the app will ask you to pick another.

<h2 id="help-data-loader-create-workspace-button">Create workspace button</h2>

This button creates a new workspace using the name you entered.

- After creating, the workspace becomes active.
- You can then upload files or import samples.

<h2 id="help-data-loader-rename-workspace-input">Rename workspace input</h2>

Use this field to rename the **current** workspace. Rename is helpful when the project scope changes or you want to tidy your list.

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

- The upload is staged first.
- You can preview before adding it to the graph.

<h2 id="help-data-loader-import-sample-button">Import sample data</h2>

Use this to load curated sample datasets for quick experimentation.

- Great for first-time users.
- Sample data is safe to explore and delete.

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
