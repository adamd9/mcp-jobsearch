
# LinkedIn Job Search Programmatic Scraping Guide

## 1. Quick Reference of URL Parameters

| Parameter | Purpose | Example | Notes |
|-----------|---------|---------|-------|
| `keywords` | Search string (supports Boolean) | `keywords=python%20developer` | See Section&nbsp;4 for Boolean syntax |
| `location` | Plain‑text location (city/state/country) | `location=Sydney%2C%20New%20South%20Wales%2C%20Australia` | Optional if `geoId` present |
| `geoId` | LinkedIn geographic ID | `geoId=102026833` | Disambiguates location text |
| `f_PP` | Primary place filter (city/region IDs) | `f_PP=102026833%2C103644278` | Comma‑separated list of IDs (OR logic) |
| `distance` | Radius in miles (for city searches) | `distance=25` | Ignored for country‑level filters |
| `f_TPR` | Time posted (seconds) | `f_TPR=r86400` | `r86400` = 24 h, `r3600` = 1 h |
| `f_E` | Experience level | `f_E=2` | 1 Intern, 2 Entry, 3 Assoc, 4 Sr, 5 Dir, 6 Exec |
| `f_JT` | Job type | `f_JT=F,P` | F Full‑time, P Part‑time, C Contract, T Temp, V Vol, I Intern, O Other |
| `f_WT` | Workplace (on‑site/remote/hybrid) | `f_WT=1,3` | 1 On‑site, 2 Remote, 3 Hybrid |
| `f_AL` | Easy Apply only | `f_AL=true` | |
| `f_JIYN` | Fewer than 10 applicants | `f_JIYN=true` | |
| `sortBy` | Sort order | `sortBy=DD` | DD = newest, R = relevance |
| `start` | Pagination offset | `start=25` | 25 results per page |

---

## 2. Location Filtering Deep Dive

### 2.1 How job posters define location
* **On‑site & Hybrid:** must pick a **city/metro**.  
* **Remote:** may pick city, state, or country.  
* Location cannot be edited once posted.

### 2.2 How searches interpret location
* **City‑level filter** → returns only jobs tagged with *that* city.  
* **Country‑level filter** → returns jobs tagged with any city in that country **plus** posts tagged only with the country itself.  
* A job tagged “Australia” will **not** appear in a city‑only search for “Sydney”.

### 2.3 Recommended parameters
| Scenario | Recommended Params |
|----------|--------------------|
| Specific city | `location=<city>&geoId=<id>` **or** `f_PP=<id>` |
| Multiple cities | `f_PP=<id1>,<id2>,<id3>` |
| Country | `location=<country>&geoId=<id>` |
| Remote only (anywhere) | `location=Remote` **or** `f_WT=2` |
| Remote within region | `location=<country>&geoId=<id>&f_WT=2` |
| Hybrid only | `f_WT=3` |

### 2.4 Getting geo IDs programmatically
```
GET https://www.linkedin.com/jobs-guest/api/typeaheadHits
     ?origin=jserp&typeaheadType=GEO&geoTypes=POPULATED_PLACE
     &query=Sydney
```
Parse the `urn:li:fs_geo:<id>` values and store for use in `geoId` or `f_PP`.

---

## 3. Example URLs

```text
# City with 25 mi radius
https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=Sydney,%20New%20South%20Wales,%20Australia&geoId=102026833&distance=25&sortBy=DD

# Sydney OR Melbourne
https://www.linkedin.com/jobs/search/?keywords=frontend%20developer&f_PP=102026833%2C103884924&sortBy=DD

# Remote jobs in Australia
https://www.linkedin.com/jobs/search/?keywords=data%20scientist&location=Australia&geoId=101452733&f_WT=2

# Last‑hour postings in US
https://www.linkedin.com/jobs/search/?keywords=golang&location=United%20States&geoId=103644278&f_TPR=r3600
```

---

## 4. Keyword Search Behaviour

LinkedIn supports Boolean logic inside the `keywords` parameter.

| Operator (caps) | Meaning | Example | URL‑encoded |
|-----------------|---------|---------|-------------|
| _(space)_ | **OR** (default) | `marketing manager` | `marketing%20manager` |
| `AND` | All terms must appear | `python AND rust` | `python%20AND%20rust` |
| `OR` | Any term may appear | `developer OR engineer` | `developer%20OR%20engineer` |
| `NOT` | Exclude term | `javascript NOT react` | `javascript%20NOT%20react` |
| `" "` | Exact phrase | `"machine learning"` | `%22machine%20learning%22` |
| `( )` | Grouping | `("machine learning" OR AI) AND python` | `%28%22machine%20learning%22%20OR%20AI%29%20AND%20python` |

**Tips**
* Default space acts as **OR** — use `AND` to force both.  
* Quote multi‑word titles: `"site reliability engineer"`.  
* Combine stacks: `backend AND ("node.js" OR node)`.  
* Use `NOT` to weed out noise: `analyst NOT "business analyst"`.  
* Always URL‑encode spaces (`%20`) and symbols.

---

## 5. Scraper Implementation Advice

* **Prefer direct URL construction** once you know `geoId`/`f_PP` – faster than UI clicks.  
* **UI automation fallback:** if LinkedIn changes param keys, click filters in Playwright, watch URL diff, copy new param.  
* **Pagination:** increment `start=0,25,50…` until no results or limit reached.  
* **Login & anti‑bot:** keep real session cookies, randomize waits, rotate user‑agents.  
* **Edge cases:**  
  * Run a country‑level remote query to capture remote‑only jobs missed by city filters.  
  * Hybrid jobs match their specified city.  
  * Multi‑location postings are rare; covering each desired region individually is safest.

---

## 6. Quick Cheatsheet

```text
# Sydney, last 24 h, <10 applicants, entry‑or‑assoc
https://www.linkedin.com/jobs/search/?keywords=python%20developer&location=Sydney,%20NSW,%20Australia&geoId=102026833&f_TPR=r86400&f_E=2%2C3&f_JIYN=true&sortBy=DD

# Remote US, data + ML, full‑time
https://www.linkedin.com/jobs/search/?keywords=(data%20scientist%20OR%20"machine%20learning")%20AND%20python&location=United%20States&geoId=103644278&f_WT=2&f_JT=F
```
