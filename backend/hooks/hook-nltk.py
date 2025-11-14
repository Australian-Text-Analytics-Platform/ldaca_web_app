"""Custom PyInstaller hook for :mod:`nltk`.

We intentionally avoid bundling any NLTK corpora or enabling the default
runtime hook so that the frozen executable can defer importing NLTK until
the text endpoints explicitly need it. This keeps startup time fast and
lets NLTK download data into the user's cache on demand.
"""

# Do not collect bundled corpora.
datas = []

# No additional hidden imports beyond what the analyser discovers.
hiddenimports = []

# Crucially, disable the stock runtime hook that eagerly imports nltk.
runtime_hooks = []
