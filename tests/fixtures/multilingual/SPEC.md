# Multilingual fixture spec — instructions for an external LLM (e.g., GPT)

Paste this whole document into a fresh chat. Output one CSV file at a time; each file should be plain text, no markdown fences, no commentary.

---

## Goal

Build six CSV files used as regression-test fixtures for the
`pluggable_tokeniser` work on a multilingual text analytics web app.
They cover three languages (English, Simplified Chinese, Japanese)
in two collections (literary varied corpus, parallel UDHR articles).

The fixtures only need to be **stable** and **realistic** — exact
verbatim accuracy to a specific edition is not required. They are
regression inputs, not authoritative texts.

---

## Deliverables

Six files, all under `tests/fixtures/multilingual/`:

```
literary/en.csv     20 rows, English literary excerpts
literary/zh.csv     20 rows, Simplified Chinese literary excerpts
literary/ja.csv     20 rows, Japanese literary excerpts

udhr/en.csv         12 rows, UDHR articles in English
udhr/zh.csv         12 rows, same UDHR articles in Simplified Chinese
udhr/ja.csv         12 rows, same UDHR articles in Japanese
```

Produce all six. Each file is independent — no cross-file references.

---

## CSV format (strict)

- **Header row exactly**: `id,text`
- **Encoding**: UTF-8, no BOM
- **Line endings**: LF (`\n`), not CRLF
- **IDs**: 1-based integers, contiguous (`1`, `2`, ..., `N`)
- **Text field**: a single line of natural-language text (no embedded newlines, no tabs, no null bytes)
- **Quoting**: wrap every `text` field in double quotes. If the text itself contains a `"`, double it: `"` → `""`. Example:

```csv
id,text
1,"It was the best of times, it was the worst of times."
2,"He said ""hello"" and walked away."
```

- **Length per text field**: aim for 30–200 characters. Avoid very long or very short entries — keep distribution roughly uniform.
- **No special markup**: no HTML, no LaTeX, no markdown, no `<` or `>` placeholders.
- **Do not** include language tags, source citations, or commentary inside the text field — just the excerpt itself.

---

## Per-file specifications

### `literary/en.csv` — 20 rows

20 short excerpts (one or two sentences each) from public-domain English-language works. Mix of authors, periods, and genres.

Suggested sources (use whichever you can produce confidently — substitute freely):
- Austen — *Pride and Prejudice*, *Sense and Sensibility*, *Emma*
- M. Shelley — *Frankenstein*
- Doyle — *A Study in Scarlet*, *The Hound of the Baskervilles*
- Carroll — *Alice's Adventures in Wonderland*
- Melville — *Moby-Dick*
- E. Brontë — *Wuthering Heights*; C. Brontë — *Jane Eyre*
- Dickens — *A Tale of Two Cities*, *Great Expectations*, *Oliver Twist*
- Wells — *The War of the Worlds*, *The Time Machine*
- Stevenson — *Treasure Island*, *Dr Jekyll and Mr Hyde*
- Stoker — *Dracula*
- Wilde — *The Picture of Dorian Gray*
- Twain — *The Adventures of Tom Sawyer*, *Huckleberry Finn*
- Conrad — *Heart of Darkness*
- Defoe — *Robinson Crusoe*
- Verne — *Twenty Thousand Leagues Under the Sea*
- Hawthorne — *The Scarlet Letter*

Constraint: every author/work pre-1929 to stay clearly out of copyright in the US (Australian/UK rules are similar in practice). Do NOT include Hemingway, Fitzgerald (Gatsby is a borderline case — skip), Faulkner, Orwell, etc.

### `literary/zh.csv` — 20 rows

20 short excerpts from public-domain Chinese-language works. Mix of classical and early-modern.

Suggested sources:
- Classical philosophy/history: 《论语》《道德经》《孟子》《庄子》《史记》《左传》《诗经》
- Classical fiction: 《三国演义》《红楼梦》《水浒传》《西游记》《聊斋志异》
- Tang/Song poetry (single short poems or couplets count as one entry): 李白、杜甫、王维、白居易、苏轼、李清照
- Early modern (pre-1929): 鲁迅 (《狂人日记》《阿Q正传》《故乡》openings), 周作人, 朱自清 (《背影》《春》openings), 老舍 early work

Use Simplified Chinese characters throughout. Mix periods and genres. Avoid post-1929 living authors.

### `literary/ja.csv` — 20 rows

20 short excerpts from public-domain Japanese-language works. Mix of classical and early-modern.

Suggested sources (Aozora Bunko has all of these out of copyright in Japan):
- Heian/Edo classics: 紫式部《源氏物語》, 清少納言《枕草子》, 鴨長明《方丈記》, 兼好法師《徒然草》, 松尾芭蕉 haiku
- Meiji/Taishō/early Shōwa: 夏目漱石 (《吾輩は猫である》《坊っちゃん》《こころ》openings), 芥川龍之介 (《羅生門》《蜘蛛の糸》openings), 太宰治 (《走れメロス》《人間失格》openings — Dazai died 1948, US public-domain via Japan 50-year rule), 宮沢賢治 (《銀河鉄道の夜》), 川端康成 (《雪国》famous opening — note 1968 Nobel, but early works are pre-1929 OK), 樋口一葉, 中島敦《山月記》

Use natural-Japanese mix of kanji, hiragana, katakana. Avoid all-katakana entries.

### `udhr/en.csv`, `udhr/zh.csv`, `udhr/ja.csv` — 12 rows each

Include these UN Universal Declaration of Human Rights articles (1948, public-domain UN text), same article numbers across all three files:

```
Article 1, 2, 3, 5, 9, 12, 18, 19, 23, 25, 26, 30
```

For each article, use **only the first paragraph** (don't include numbered sub-clauses like 23(2), 23(3), etc.) — this keeps every row to a single short line of text.

Use the UN's official translation into each language. If you don't have the exact official phrasing, write a close paraphrase — exact wording isn't critical for regression testing, but the article should be recognisable.

ID column should match article number for these files (id=1 means Article 1, id=5 means Article 5, etc.) so cross-file joins are trivial.

---

## Output format

Output each file as a separate fenced block, but the **CONTENT** inside the block must be raw CSV (no markdown, no comments):

````
=== literary/en.csv ===
```
id,text
1,"..."
2,"..."
...
20,"..."
```
````

Six such blocks, one per file. Headers are exactly `id,text`. No trailing blank line.

---

## Quality checklist (verify before submitting each file)

- [ ] Header row is exactly `id,text`
- [ ] Row count matches spec (20 for literary, 12 for UDHR)
- [ ] IDs are contiguous 1-based integers (literary) or article-number-matched (UDHR)
- [ ] Every `text` field is wrapped in double quotes
- [ ] Internal `"` characters are doubled (`""`)
- [ ] No embedded newlines, tabs, or null bytes
- [ ] Length 30–200 characters per text field
- [ ] No copyrighted content (pre-1929 works only, plus UDHR)
- [ ] Mix of authors / periods / genres
- [ ] All UTF-8; LF line endings

---

## Where to put the files

After GPT produces the six blocks, save each to its corresponding path under `tests/fixtures/multilingual/` and commit. Don't worry about whether the contents look "right" — they're regression fixtures, not a corpus for analysis. Stability matters; exact wording does not.
