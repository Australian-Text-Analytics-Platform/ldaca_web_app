"""Custom PyInstaller runtime hook overriding the default NLTK hook.

The stock PyInstaller runtime hook eagerly imports :mod:`nltk` to configure
NLTK's bundled data directory. That import pulls in SciPy and other optional
packages, adding noticeable startup latency to the frozen executable.

We don't package any NLTK corpora inside the binary, so the hook can be a
no-op. At runtime NLTK will resolve its own data path and download resources
into the user's default cache (e.g. ``~/.cache/nltk``) when the API explicitly
requests them.
"""

# Intentionally left blank: we want to skip PyInstaller's default hook logic.
