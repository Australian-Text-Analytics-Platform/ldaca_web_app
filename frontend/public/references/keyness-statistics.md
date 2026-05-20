<!-- markdownlint-disable MD033 -->

<h1 id="ref-token-frequency-keyness-statistics">Keyword Analysis — method &amp; citations</h1>

The **Keyword Analysis** table on the Token Frequency tool compares two corpora token-by-token using the standard set of log-likelihood-based keyness measures documented in the **Lancaster log-likelihood and effect-size wizard** (Rayson, UCREL). Wordflow's implementation matches the wizard's formulas at 1 degree of freedom; values should reproduce the wizard's output exactly on the same input frequencies.

> **Primary citation — the wizard / method overview:**
> Rayson, P. **Log-likelihood and effect size calculator.** UCREL, Lancaster University. <https://ucrel.lancs.ac.uk/llwizard.html>.

---

## What each column computes

Throughout, **C1 = reference corpus**, **C2 = study corpus** (the radio-selected block in the Wordflow UI). `O_i` is the observed frequency of a token in corpus `i`; `C_i` is the total token count in corpus `i`; `NF_i = O_i / C_i` is the normalised frequency; `N = C_1 + C_2`; `E_i = C_i × (O_1 + O_2) / N` is the expected frequency under the independence null.

| Column | Formula | Source |
|---|---|---|
| **LL** (log-likelihood G²) | `2 × (O_1 × ln(O_1 / E_1) + O_2 × ln(O_2 / E_2))` | Dunning (1993) — *Accurate methods for the statistics of surprise and coincidence.* **Computational Linguistics**, 19(1), 61–74. |
| **Bayes (BIC)** | `LL − ln(N)` (1 df) | Wilson, A. (2013) — *Embracing Bayes factors for key item analysis in corpus linguistics.* In **New Approaches to the Study of Linguistic Variability**, 3–11. |
| **ELL** (effect size for log-likelihood) | `LL / (N × ln(E_min))` where `E_min = min(E_1, E_2)` | Johnston, J., Berry, K., & Mielke, P. (2006) — *Measures of effect size for chi-squared and likelihood-ratio goodness-of-fit tests.* **Perceptual and Motor Skills**, 103, 412–414. |
| **%DIFF** | `((NF_2 − NF_1) / NF_1) × 100` | Gabrielatos, C., & Marchi, A. (2012) — *Keyness: appropriate metrics and practical issues.* CADS International Conference 2012, University of Bologna. |
| **RRisk** (relative risk) | `NF_1 / NF_2` | Standard 2×2 contingency table. See Hardie (2014). |
| **LogRatio** | `log₂(NF_2 / NF_1)` — positive ⇒ token skews toward the study corpus | Hardie, A. (2014) — *Log Ratio — an informal introduction.* **CASS Centre for Corpus Approaches to Social Science.** <http://cass.lancs.ac.uk/log-ratio-an-informal-introduction/>. |
| **OddsRatio** | `(O_1 × (C_2 − O_2)) / (O_2 × (C_1 − O_1))` | Standard 2×2 contingency table. |
| **Significance** | log-likelihood critical values at 1 df: `*` p<0.05 (LL ≥ 3.84), `**` p<0.01 (LL ≥ 6.63), `***` p<0.001 (LL ≥ 10.83), `****` p<0.0001 (LL ≥ 15.13) | Rayson, P. (Lancaster log-likelihood wizard). |

---

## How to cite Wordflow's keyword analysis

A typical methodology paragraph:

> Keyword analysis was performed using the **LDaCA Wordflow** Token Frequency tool, which implements the log-likelihood (G²) keyness statistic and associated effect-size measures as documented in the Lancaster log-likelihood and effect-size wizard (Rayson, UCREL — <https://ucrel.lancs.ac.uk/llwizard.html>). Significance thresholds follow log-likelihood critical values at 1 df (Rayson). The Bayes factor (BIC) follows Wilson (2013), the effect size for log-likelihood (ELL) follows Johnston et al. (2006), %DIFF follows Gabrielatos &amp; Marchi (2012), and the Log Ratio (binary log of the relative risk) follows Hardie (2014).

If you publish results that depend on the Wordflow implementation specifically (e.g. for reproducibility), also cite Wordflow itself — see the [Wordflow citation reference](./general.md).

---

## Reproducing the numbers in the Lancaster wizard

The wizard at <https://ucrel.lancs.ac.uk/llwizard.html> accepts the same four inputs Wordflow uses internally — `O_1, O_2, C_1, C_2` — and reports `LL`, `BIC`, `ELL`, `%DIFF`, `Relative Risk`, `Log Ratio`, and `Odds Ratio`. Comparing a Wordflow row against the wizard's output on the same numbers is a useful sanity check when the table behaves unexpectedly.

---

© Language Data Commons of Australia (LDaCA)

Version {{VERSION}} - released on {{BUILD_DATE}}.
