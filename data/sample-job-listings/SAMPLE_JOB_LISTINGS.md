# 100 Sample Job Listings

> **Demo content.** Sample listings: employers are fictional, salaries are illustrative and these are not verified vacancies.

25 listings per region, generated as importable data. The machine-readable versions of this
document are `sample-jobs.json`, `sample-jobs.sql` and `sample-jobs.js` in the same folder.

## How the records were built

| Rule | How it is met |
|---|---|
| 25 per region | Asserted by `validateSampleJobs()`; the build fails otherwise |
| No repeated title within a region | Checked per region |
| Several countries per region | Europe 11, Africa 11, Asia 11, Americas 9 |
| Local currencies | Each listing quotes the currency of its own country (EUR for six eurozone states, GBP/SEK/PLN/CHF, KES/NGN/ZAR/GHS/…, INR/PHP/SGD/…, USD/CAD/BRL/MXN/…) |
| Beginner and experienced roles | Every region has Entry-level, Intermediate and Experienced listings |
| Remote, hybrid and onsite | Every region has all three arrangements |
| Sample-marked | `isSample: true` on all 100, plus the disclosure above |
| Illustrative pay | Rates are plausible for each market, not sourced vacancies |

`salaryUsd` is the same amount converted once, at the rate noted in the column header below, so
a board that prices in USD can sort and filter without a live FX call. Re-run the conversion at
import time if your platform needs today's rate.

Approximate rates used: EUR 1.082, GBP 1.256, CHF 1.122, SEK 0.0946, PLN 0.25,
KES 0.0077, NGN 0.00064, ZAR 0.0546, GHS 0.0868, UGX 0.00027, TZS 0.000385, RWF 0.000723,
EGP 0.02, MAD 0.1, ETB 0.0068, BWP 0.073, INR 0.012, PHP 0.0172, SGD 0.767, MYR 0.224,
JPY 0.0067, IDR 0.000064, THB 0.0289, KRW 0.000707, VND 0.0000395, PKR 0.0036,
BDT 0.0081, CAD 0.729, BRL 0.185, MXN 0.055, ARS 0.00085, COP 0.00026, CLP 0.00106,
PEN 0.266, CRC 0.0019.

## EUROPE — 25 JOBS

### 1. Virtual Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-001` |
| Company (fictional) | Nordwind Assist GmbH |
| Location | Berlin, Germany |
| Region | Europe |
| Salary | 22 EUR hourly (≈ $23.8) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Secondary school diploma; relevant certificates welcome |
| Application deadline | 2026-12-19 |
| Applicants so far | 84 |

Support a two-partner consulting firm with inbox triage, calendar coordination and travel booking across three time zones. You will own the morning brief and keep client follow-ups from slipping between meetings.

**Required skills:** Calendar management · Written German and English · Google Workspace · Notion

**Application requirements:** CV (PDF, max 2 pages) · Short cover note in German · Availability across CET business hours

### 2. Data Entry Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-002` |
| Company (fictional) | Thames Record Services Ltd |
| Location | Manchester, United Kingdom |
| Region | Europe |
| Salary | 14 GBP hourly (≈ $17.6) |
| Employment type | Contract |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | GCSEs or equivalent |
| Application deadline | 2026-12-12 |
| Applicants so far | 132 |

Transfer paper archive records into a structured compliance database, reconciling each entry against the scanned source. The backlog is roughly 12,000 records and accuracy is audited on a sample every week.

**Required skills:** High-volume data entry · Excel · Attention to detail · OCR tools

**Application requirements:** CV · A 15-minute accuracy test · Right to work in the UK

### 3. Junior Web Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-003` |
| Company (fictional) | Lumen Studio SARL |
| Location | Lyon, France |
| Region | Europe |
| Salary | 2,400 EUR monthly (≈ $2,596) |
| Employment type | Internship |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | Bachelor’s degree in computer science or a portfolio of equivalent work |
| Application deadline | 2027-01-09 |
| Applicants so far | 61 |

Build and maintain client marketing sites on a modern JavaScript stack, working alongside a senior developer who reviews every pull request. You will ship small features weekly and learn the deployment pipeline from the inside.

**Required skills:** JavaScript · HTML/CSS · React · Git

**Application requirements:** CV · Portfolio or GitHub profile · One code sample

### 4. Customer Support Representative

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-004` |
| Company (fictional) | Kanaal Telecom B.V. |
| Location | Rotterdam, Netherlands |
| Region | Europe |
| Salary | 2,650 EUR monthly (≈ $2,866) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Secondary school diploma |
| Application deadline | 2026-12-22 |
| Applicants so far | 47 |

Be the first human a customer reaches when their connection fails, handling chat and phone queues in Dutch and English. You will resolve what you can and hand the rest to engineering with a clear, reproducible note.

**Required skills:** Dutch and English · Zendesk · Troubleshooting · Clear written handovers

**Application requirements:** CV in Dutch or English · Short role-play call · Availability for weekend rotation

### 5. AI Data Annotator

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-005` |
| Company (fictional) | Aisling AI Labs |
| Location | Dublin, Ireland |
| Region | Europe |
| Salary | 18 EUR hourly (≈ $19.5) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Secondary school diploma; linguistics students welcome |
| Application deadline | 2026-12-15 |
| Applicants so far | 208 |

Label image and text pairs for a European-language model, applying a 40-page annotation guide to ambiguous cases. Reviewers sample your work weekly, and the edge-case notes you write feed directly back into the guide.

**Required skills:** Annotation tooling · English reading comprehension · Consistency under a written rubric

**Application requirements:** CV · A 30-minute calibration task · Signed data-handling acknowledgement

### 6. Digital Marketing Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-006` |
| Company (fictional) | Solera Growth SL |
| Location | Barcelona, Spain |
| Region | Europe |
| Salary | 2,950 EUR monthly (≈ $3,190) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree in marketing, business or a related field |
| Application deadline | 2027-01-05 |
| Applicants so far | 96 |

Own paid social and search for a portfolio of mid-market consumer brands, with a monthly budget you will defend with data. You will run creative tests, report on cost per acquisition and brief the design team on what won.

**Required skills:** Meta Ads · Google Ads · Looker Studio · Spanish and English

**Application requirements:** CV · A one-page case study of a campaign you ran · Salary expectation

### 7. Software Tester

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-007` |
| Company (fictional) | Verona Quality Lab S.r.l. |
| Location | Milan, Italy |
| Region | Europe |
| Salary | 2,750 EUR monthly (≈ $2,974) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree or ISTQB certification |
| Application deadline | 2026-12-29 |
| Applicants so far | 58 |

Write and run manual regression suites for a payments platform, then push the repetitive cases into an automated pipeline. You will log defects that developers can reproduce without asking you a follow-up question.

**Required skills:** Test case design · Playwright or Cypress · Jira · SQL basics

**Application requirements:** CV · Two examples of well-written defect reports · Right to work in the EU

### 8. Content Writer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-008` |
| Company (fictional) | Fjord & Pen AB |
| Location | Stockholm, Sweden |
| Region | Europe |
| Salary | 41,000 SEK monthly (≈ $3,880) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree in journalism, English or communications |
| Application deadline | 2027-01-02 |
| Applicants so far | 74 |

Write long-form guides and product explainers for a B2B software client, working from interviews with their engineers. Every piece is fact-checked, so your sourcing has to hold up as well as your prose.

**Required skills:** Long-form English writing · Technical interviewing · SEO fundamentals · Editorial sourcing

**Application requirements:** CV · Three published writing samples · A 300-word test brief

### 9. Graphic Designer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-009` |
| Company (fictional) | Kraków Brand House sp. z o.o. |
| Location | Kraków, Poland |
| Region | Europe |
| Salary | 8,200 PLN monthly (≈ $2,050) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Degree in graphic design or a strong portfolio |
| Application deadline | 2026-12-27 |
| Applicants so far | 118 |

Produce print and digital assets for retail campaigns, from shelf artwork to social cut-downs, inside a shared Figma library. You will work to a brand system rather than inventing one, and hand off production-ready files.

**Required skills:** Figma · Adobe Illustrator · Print production · Brand systems

**Application requirements:** CV · Portfolio (PDF or link) · Two references

### 10. Social Media Manager

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-010` |
| Company (fictional) | Helvetia Voice AG |
| Location | Zurich, Switzerland |
| Region | Europe |
| Salary | 6,400 CHF monthly (≈ $7,180) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree in communications or marketing |
| Application deadline | 2027-01-12 |
| Applicants so far | 63 |

Run the day-to-day presence for a financial-services brand across LinkedIn and Instagram, in German and French. You will draft copy, schedule the calendar and escalate anything that touches a regulated claim.

**Required skills:** German and French copywriting · LinkedIn content strategy · Compliance-aware publishing · Scheduling tools

**Application requirements:** CV · Writing samples in German and French · Two references

### 11. SEO Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-011` |
| Company (fictional) | Brussels Search Collective |
| Location | Brussels, Belgium |
| Region | Europe |
| Salary | 3,300 EUR monthly (≈ $3,568) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or equivalent experience |
| Application deadline | 2027-01-07 |
| Applicants so far | 89 |

Audit and improve a multilingual e-commerce site competing in Dutch, French and English search results. You will own technical hygiene, brief the content team and report monthly on what actually moved.

**Required skills:** Technical SEO · Ahrefs or Semrush · Multilingual content strategy · Google Search Console

**Application requirements:** CV · A short audit of any site you choose · Languages spoken

### 12. IT Support Technician

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-012` |
| Company (fictional) | Rheinwerk Systems GmbH |
| Location | Cologne, Germany |
| Region | Europe |
| Salary | 24 EUR hourly (≈ $26) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Intermediate |
| Education | IT apprenticeship, CompTIA A+ or a related degree |
| Application deadline | 2026-12-24 |
| Applicants so far | 41 |

Provide first and second-line support for 200 staff across two offices, from laptop provisioning to network troubleshooting. You will keep the asset register honest and write the fix into the internal knowledge base.

**Required skills:** Windows and macOS administration · Active Directory · Networking basics · Ticketing systems

**Application requirements:** CV · Proof of certification · Right to work in Germany

### 13. Business Analyst

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-013` |
| Company (fictional) | Caledonia Process Partners |
| Location | Edinburgh, United Kingdom |
| Region | Europe |
| Salary | 52 GBP hourly (≈ $65.4) |
| Employment type | Contract |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree; IIBA certification an advantage |
| Application deadline | 2026-12-31 |
| Applicants so far | 37 |

Map how a public-sector client actually processes benefits claims, then write the requirements for the system that will replace it. You will sit between operational staff and developers and translate in both directions.

**Required skills:** Process mapping · BPMN · Stakeholder facilitation · Requirements documentation

**Application requirements:** CV (max 3 pages) · Two examples of requirements you authored · SC clearance eligibility

### 14. Project Coordinator

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-014` |
| Company (fictional) | Orbital Build Management |
| Location | Cork, Ireland |
| Region | Europe |
| Salary | 4,200 EUR monthly (≈ $4,540) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree in construction management, business or engineering |
| Application deadline | 2027-01-04 |
| Applicants so far | 52 |

Keep a portfolio of construction fit-outs on schedule: chase dependencies, maintain the risk log and run the weekly stand-up. You will not own the design, but everyone will rely on your tracker being current.

**Required skills:** MS Project or Asana · Risk tracking · Minutes and action logs · Stakeholder communication

**Application requirements:** CV · A description of a project you coordinated · Driving licence

### 15. Online Research Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-015` |
| Company (fictional) | Atelier Recherche SAS |
| Location | Bordeaux, France |
| Region | Europe |
| Salary | 15 EUR hourly (≈ $16.2) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Bachelor’s degree in progress or completed |
| Application deadline | 2026-12-17 |
| Applicants so far | 156 |

Compile verified market data for a consultancy’s client reports, sourcing every figure to a page you actually opened. You will be asked to distinguish a published number from an estimate, and to say which is which.

**Required skills:** Web research · Source citation · Excel or Google Sheets · French and English

**Application requirements:** CV · A one-page sourced summary of any market · Weekly availability

### 16. E-commerce Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-016` |
| Company (fictional) | Madrid Mart Online SL |
| Location | Valencia, Spain |
| Region | Europe |
| Salary | 2,100 EUR monthly (≈ $2,272) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | Secondary school diploma |
| Application deadline | 2026-12-20 |
| Applicants so far | 91 |

Keep product listings accurate on a marketplace doing 4,000 orders a month: descriptions, variants, stock and pricing. You will flag the listings that keep attracting returns and fix the cause, not the complaint.

**Required skills:** Shopify or PrestaShop · Product data accuracy · Excel · Spanish and English

**Application requirements:** CV in Spanish · Short note on a listing you would improve · Availability for peak season

### 17. Python Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-017` |
| Company (fictional) | Delta Insight Analytics B.V. |
| Location | Amsterdam, Netherlands |
| Region | Europe |
| Salary | 4,800 EUR monthly (≈ $5,191) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree in computer science or equivalent experience |
| Application deadline | 2027-01-14 |
| Applicants so far | 44 |

Build the data pipelines that feed a logistics forecasting product, from ingestion to the API the front end reads. You will work in a small team where your code goes to production in the week you write it.

**Required skills:** Python · SQL · Airflow or Dagster · Docker · API design

**Application requirements:** CV · GitHub or code sample · One technical interview

### 18. UI/UX Designer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-018` |
| Company (fictional) | Studio Meridian GmbH |
| Location | Munich, Germany |
| Region | Europe |
| Salary | 5,400 EUR monthly (≈ $5,839) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Degree in interaction design or a strong portfolio |
| Application deadline | 2027-01-16 |
| Applicants so far | 67 |

Design onboarding and account flows for a regulated insurance app, working inside an existing design system. You will run usability sessions with real customers monthly and defend your decisions with what they showed.

**Required skills:** Figma · Usability testing · Design systems · Accessibility (WCAG 2.2)

**Application requirements:** CV · Portfolio with process notes · Two references

### 19. Financial Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-019` |
| Company (fictional) | Brabant Fiduciair B.V. |
| Location | Antwerp, Belgium |
| Region | Europe |
| Salary | 3,150 EUR monthly (≈ $3,406) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Bachelor’s degree in accounting or finance |
| Application deadline | 2026-12-23 |
| Applicants so far | 39 |

Support an accounting team with reconciliations, supplier payments and month-end close for 30 small business clients. You will chase the missing invoices rather than waiting for them to arrive.

**Required skills:** Bookkeeping · Excel · Dutch and English · Accounting software (Exact or Odoo)

**Application requirements:** CV · Transcripts · Right to work in Belgium

### 20. Transcription Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-020` |
| Company (fictional) | Lingua Verbatim S.r.l. |
| Location | Rome, Italy |
| Region | Europe |
| Salary | 16 EUR hourly (≈ $17.3) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Secondary school diploma; legal or medical terminology training welcome |
| Application deadline | 2026-12-18 |
| Applicants so far | 173 |

Transcribe recorded clinical and legal interviews in Italian and English, following a strict verbatim style sheet. Inaudible passages are marked, never reconstructed, and every file is spot-checked against its audio.

**Required skills:** Italian and English · Verbatim transcription · Foot-pedal workflow · Confidentiality handling

**Application requirements:** CV · A two-minute timed transcription test · Signed confidentiality agreement

### 21. AI Model Evaluator

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-021` |
| Company (fictional) | Nordic Model Trust AB |
| Location | Gothenburg, Sweden |
| Region | Europe |
| Salary | 260 SEK hourly (≈ $24.6) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or equivalent demonstrated work |
| Application deadline | 2027-01-06 |
| Applicants so far | 121 |

Score model responses against a written rubric for safety, accuracy and helpfulness across Swedish and English. Half the job is noticing that the rubric has no answer for what you just read, and saying so.

**Required skills:** Swedish and English fluency · Rubric-based evaluation · Clear written rationales · Bias awareness

**Application requirements:** CV · A five-item evaluation test · Signed data-handling acknowledgement

### 22. Technical Support Agent

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-022` |
| Company (fictional) | Alpine Cloud Services AG |
| Location | Geneva, Switzerland |
| Region | Europe |
| Salary | 38 CHF hourly (≈ $42.6) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree or vendor certification |
| Application deadline | 2027-01-10 |
| Applicants so far | 29 |

Take escalations from business customers running their systems on a managed cloud platform, in French, German and English. Your job is to reproduce the fault before you route it, not after.

**Required skills:** Linux administration · Networking · French, German and English · Incident reproduction

**Application requirements:** CV · Two examples of escalations you owned · On-call availability

### 23. WordPress Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-023` |
| Company (fictional) | Warsaw Web Foundry sp. z o.o. |
| Location | Warsaw, Poland |
| Region | Europe |
| Salary | 11,000 PLN monthly (≈ $2,750) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Equivalent experience accepted in place of a degree |
| Application deadline | 2027-01-03 |
| Applicants so far | 73 |

Maintain 40 client WordPress sites: security patches, plugin conflicts, performance and the occasional bespoke block. You will be the person who fixes the site before the client notices it was slow.

**Required skills:** WordPress · PHP · MySQL · ACF and custom blocks · Site security

**Application requirements:** CV · Two sites you built or maintain · Availability for an on-call rota

### 24. Online English Tutor

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-024` |
| Company (fictional) | Bright Path Languages Ltd |
| Location | London, United Kingdom |
| Region | Europe |
| Salary | 19 GBP hourly (≈ $23.9) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Bachelor’s degree plus TEFL/CELTA certificate |
| Application deadline | 2026-12-21 |
| Applicants so far | 187 |

Teach one-to-one English conversation to adult professionals, mostly in 50-minute evening slots. Lesson plans are provided, but the best tutors adapt them to what the student actually struggles with.

**Required skills:** English language teaching · TEFL or CELTA · Video conferencing · Lesson adaptation

**Application requirements:** CV · Certificate scan · A 15-minute demo lesson

### 25. Cybersecurity Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-EU-025` |
| Company (fictional) | Corkline Security Partners |
| Location | Galway, Ireland |
| Region | Europe |
| Salary | 3,400 EUR monthly (≈ $3,677) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Bachelor’s degree in cybersecurity, or CompTIA Security+ |
| Application deadline | 2027-01-08 |
| Applicants so far | 46 |

Support a security team with vulnerability triage, phishing case handling and evidence collection for audit. You will learn the incident workflow by running the parts that do not need a senior analyst.

**Required skills:** Networking fundamentals · SIEM basics · Linux · Incident documentation

**Application requirements:** CV · Certification scan if held · Right to work in Ireland

## AFRICA — 25 JOBS

### 1. AI Data Annotator

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-001` |
| Company (fictional) | Savanna Label Works |
| Location | Nairobi, Kenya |
| Region | Africa |
| Salary | 900 KES hourly (≈ $6.95) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Secondary school certificate; linguistics students welcome |
| Application deadline | 2026-12-16 |
| Applicants so far | 341 |

Label Swahili and English text pairs for a language model being tested on East African content, working from a detailed annotation guide. You will flag the cases the guide does not cover rather than deciding on your own.

**Required skills:** Swahili and English · Annotation tooling · Consistency under a rubric

**Application requirements:** CV · A 30-minute calibration task · National ID and KRA PIN

### 2. Virtual Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-002` |
| Company (fictional) | Lagos Remote Partners |
| Location | Lagos, Nigeria |
| Region | Africa |
| Salary | 280,000 NGN monthly (≈ $180) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | OND or equivalent |
| Application deadline | 2026-12-22 |
| Applicants so far | 512 |

Manage inbox, scheduling and supplier follow-ups for a growing import business, working directly with the founder. You will be trusted with the details that decide whether a shipment leaves on time.

**Required skills:** Email management · Google Workspace · Clear written English · WhatsApp Business

**Application requirements:** CV · A short written task · Reliable internet and power backup

### 3. Graphic Designer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-003` |
| Company (fictional) | Cape Fold Studio (Pty) Ltd |
| Location | Cape Town, South Africa |
| Region | Africa |
| Salary | 190 ZAR hourly (≈ $10.4) |
| Employment type | Contract |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Diploma in graphic design or a strong portfolio |
| Application deadline | 2026-12-28 |
| Applicants so far | 164 |

Design campaign assets for retail and hospitality clients, from social posts to in-store signage, within an established brand kit. You will present your work to the client and take the notes without losing the idea.

**Required skills:** Adobe Illustrator · Figma · Print production · Client presentation

**Application requirements:** CV · Portfolio link · Two references

### 4. Data Entry Clerk

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-004` |
| Company (fictional) | Accra Records Bureau |
| Location | Accra, Ghana |
| Region | Africa |
| Salary | 45 GHS hourly (≈ $3.9) |
| Employment type | Part-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | SHS certificate |
| Application deadline | 2026-12-14 |
| Applicants so far | 268 |

Enter and verify customer records from scanned forms into a CRM, correcting format without altering content. The team works to a daily quota and a weekly accuracy audit, and both matter equally.

**Required skills:** Data entry · Excel · English literacy · Typing speed above 40 wpm

**Application requirements:** CV · Typing test · Two references

### 5. Customer Support Agent

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-005` |
| Company (fictional) | Nile Commerce Group |
| Location | Cairo, Egypt |
| Region | Africa |
| Salary | 120 EGP hourly (≈ $2.4) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Bachelor’s degree preferred |
| Application deadline | 2026-12-19 |
| Applicants so far | 297 |

Handle order and delivery queries for an e-commerce platform in Arabic and English, across chat and phone. You will resolve what the policy covers and escalate the rest with the detail the next team needs.

**Required skills:** Arabic and English · CRM tools · Complaint handling · Order systems

**Application requirements:** CV in Arabic or English · A short phone screening · Shift availability

### 6. Junior Software Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-006` |
| Company (fictional) | Kampala Code Collective |
| Location | Kampala, Uganda |
| Region | Africa |
| Salary | 2,400,000 UGX monthly (≈ $640) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | Bachelor’s degree in computer science, or a strong bootcamp portfolio |
| Application deadline | 2027-01-05 |
| Applicants so far | 187 |

Build features on a mobile-money integrations platform under the review of a senior engineer. Expect to write tests, read other people’s code and ship something small every week.

**Required skills:** JavaScript or Python · Git · REST APIs · SQL

**Application requirements:** CV · GitHub profile · One code sample

### 7. Digital Marketing Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-007` |
| Company (fictional) | Dar Media House Ltd |
| Location | Dar es Salaam, Tanzania |
| Region | Africa |
| Salary | 1,400,000 TZS monthly (≈ $540) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Diploma in marketing or communications |
| Application deadline | 2026-12-26 |
| Applicants so far | 143 |

Support paid social campaigns for consumer brands: build the ads, track the spend and report what worked each week. You will learn to read a dashboard before you are asked to defend a budget.

**Required skills:** Meta Ads Manager · Canva · Excel reporting · Swahili and English

**Application requirements:** CV · A sample ad you created · Portfolio of any kind

### 8. Social Media Manager

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-008` |
| Company (fictional) | Joburg Brand Kitchen |
| Location | Johannesburg, South Africa |
| Region | Africa |
| Salary | 28,000 ZAR monthly (≈ $1,530) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Diploma or degree in marketing, communications or journalism |
| Application deadline | 2027-01-02 |
| Applicants so far | 221 |

Own the social calendar for three consumer clients, from copy to community replies to the monthly report. You will be the brand’s voice on a bad day as well as a good one.

**Required skills:** Copywriting · Community management · Instagram and TikTok · Reporting

**Application requirements:** CV · Writing samples · Two references

### 9. Content Writer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-009` |
| Company (fictional) | Kigali Story Lab |
| Location | Kigali, Rwanda |
| Region | Africa |
| Salary | 750,000 RWF monthly (≈ $540) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree in journalism, English or communications |
| Application deadline | 2027-01-07 |
| Applicants so far | 118 |

Write explainer articles and case studies for development-sector clients, working from interviews and programme documents. Each piece has to be accurate enough to be quoted by the client.

**Required skills:** English writing · Interviewing · Research · Editing

**Application requirements:** CV · Three writing samples · A 300-word test brief

### 10. Online Research Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-010` |
| Company (fictional) | Casablanca Insight SARL |
| Location | Casablanca, Morocco |
| Region | Africa |
| Salary | 45 MAD hourly (≈ $4.5) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Bachelor’s degree in progress or completed |
| Application deadline | 2026-12-20 |
| Applicants so far | 205 |

Gather verified market and competitor data for consulting reports, citing a real source for every figure. You will be asked to separate what is published from what is estimated, and to label which is which.

**Required skills:** Web research · Source citation · French, Arabic and English · Excel

**Application requirements:** CV · A sourced one-page market summary · Weekly availability

### 11. SEO Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-011` |
| Company (fictional) | Gaborone Growth Partners |
| Location | Gaborone, Botswana |
| Region | Africa |
| Salary | 90 BWP hourly (≈ $6.6) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Diploma or degree; SEO certification an advantage |
| Application deadline | 2026-12-30 |
| Applicants so far | 87 |

Support an SEO lead with keyword research, on-page fixes and monthly reporting for local businesses. You will learn to tell a ranking change from a seasonality change before you report either.

**Required skills:** Keyword research · Google Search Console · On-page SEO · Spreadsheets

**Application requirements:** CV · A short SEO audit of any site · Internet access

### 12. IT Support Technician

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-012` |
| Company (fictional) | Nairobi Network Solutions |
| Location | Nairobi, Kenya |
| Region | Africa |
| Salary | 65,000 KES monthly (≈ $503) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Intermediate |
| Education | Diploma in IT or CompTIA A+ |
| Application deadline | 2026-12-24 |
| Applicants so far | 176 |

Support 120 staff across two offices with hardware, accounts and network faults, logging every fix in a shared queue. You will be the first call when something stops working, and the person who documents why.

**Required skills:** Windows administration · Networking · Hardware repair · Ticketing systems

**Application requirements:** CV · Certification copies · Two references

### 13. Web Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-013` |
| Company (fictional) | Abuja Web Studio |
| Location | Abuja, Nigeria |
| Region | Africa |
| Salary | 420,000 NGN monthly (≈ $270) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Degree or demonstrable portfolio |
| Application deadline | 2027-01-03 |
| Applicants so far | 236 |

Build and maintain client websites on a modern stack, from landing pages to small booking systems. You will work directly with clients, which means scope conversations as well as code.

**Required skills:** JavaScript · React · Node.js · MySQL · Git

**Application requirements:** CV · Two live sites you built · GitHub profile

### 14. AI Trainer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-014` |
| Company (fictional) | Addis Model Guild |
| Location | Addis Ababa, Ethiopia |
| Region | Africa |
| Salary | 600 ETB hourly (≈ $4.1) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or equivalent experience |
| Application deadline | 2027-01-09 |
| Applicants so far | 152 |

Write and review training prompts in Amharic and English, then grade model responses against a written rubric. The work rewards people who can explain exactly why an answer is wrong.

**Required skills:** Amharic and English fluency · Prompt writing · Rubric evaluation · Written rationales

**Application requirements:** CV · A five-item evaluation test · Signed data-handling acknowledgement

### 15. Transcription Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-015` |
| Company (fictional) | Accra Verbatim Ltd |
| Location | Kumasi, Ghana |
| Region | Africa |
| Salary | 40 GHS hourly (≈ $3.5) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | SHS certificate |
| Application deadline | 2026-12-18 |
| Applicants so far | 198 |

Transcribe recorded interviews and focus groups in English and Twi, with speaker labels and time markers. Inaudible passages are marked, never guessed, and every file is checked against its audio.

**Required skills:** English and Twi · Verbatim transcription · Time-stamping · Headphones and quiet space

**Application requirements:** CV · A two-minute timed transcription test · Stable internet

### 16. E-commerce Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-016` |
| Company (fictional) | Cape Cart Online |
| Location | Durban, South Africa |
| Region | Africa |
| Salary | 18,000 ZAR monthly (≈ $982) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | Matric certificate |
| Application deadline | 2026-12-21 |
| Applicants so far | 265 |

Maintain product listings, stock counts and pricing on an online store doing 3,000 orders a month. You will track returns by listing and fix the ones causing repeat complaints.

**Required skills:** Shopify · Excel · Product data accuracy · Customer correspondence

**Application requirements:** CV · Short note on a listing you would improve · Availability for peak season

### 17. Video Editor

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-017` |
| Company (fictional) | Nairobi Frame Studio |
| Location | Nairobi, Kenya |
| Region | Africa |
| Salary | 1,200 KES hourly (≈ $9.3) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Diploma in film or media, or a strong reel |
| Application deadline | 2027-01-06 |
| Applicants so far | 149 |

Cut short-form video for social campaigns and client documentaries, from rough assembly to final delivery. You will work with supplied footage and turn around edits inside 48 hours.

**Required skills:** Premiere Pro · DaVinci Resolve · Colour basics · Subtitle workflows

**Application requirements:** CV · Showreel link · A short test edit

### 18. Business Development Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-018` |
| Company (fictional) | Kigali Trade Bridge Ltd |
| Location | Kigali, Rwanda |
| Region | Africa |
| Salary | 600,000 RWF monthly (≈ $434) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Bachelor’s degree in business or a related field |
| Application deadline | 2026-12-29 |
| Applicants so far | 96 |

Research prospective partners, prepare pitch material and keep the pipeline current for a cross-border logistics firm. You will be measured on the quality of the meetings you help set up.

**Required skills:** Prospecting research · CRM hygiene · English and French · Presentation building

**Application requirements:** CV · A one-page market note · Two references

### 19. Online Tutor

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-019` |
| Company (fictional) | Lagos Learning Circle |
| Location | Lagos, Nigeria |
| Region | Africa |
| Salary | 18,000 NGN hourly (≈ $11.6) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree in education or a related subject |
| Application deadline | 2026-12-25 |
| Applicants so far | 388 |

Teach mathematics and English to secondary students online, in small groups and one-to-one. You will set the weekly practice and mark it yourself, so progress is visible to parents.

**Required skills:** Subject expertise · Online teaching · Lesson planning · Clear communication

**Application requirements:** CV · A 15-minute demo lesson · Two references

### 20. Data Analyst

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-020` |
| Company (fictional) | Nairobi Metrics Group |
| Location | Nairobi, Kenya |
| Region | Africa |
| Salary | 135,000 KES monthly (≈ $1,040) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree in statistics, economics or computer science |
| Application deadline | 2027-01-11 |
| Applicants so far | 138 |

Turn operational data from a logistics client into reports and dashboards their managers actually use. You will spend as much time asking what the question is as writing the query.

**Required skills:** SQL · Python or R · Power BI · Dashboard design

**Application requirements:** CV · Two dashboards or analyses you built · Technical interview

### 21. Mobile Application Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-021` |
| Company (fictional) | Cape Mobile Labs |
| Location | Cape Town, South Africa |
| Region | Africa |
| Salary | 62,000 ZAR monthly (≈ $3,380) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree in computer science or equivalent experience |
| Application deadline | 2027-01-13 |
| Applicants so far | 74 |

Build and ship features for a consumer fintech app used in low-bandwidth conditions, where performance and offline behaviour matter. You will test on real devices, not just a simulator.

**Required skills:** React Native or Kotlin · REST APIs · Offline-first design · App store releases

**Application requirements:** CV · App store links to an app you shipped · Code sample

### 22. Administrative Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-022` |
| Company (fictional) | Accra Clinic Network |
| Location | Tema, Ghana |
| Region | Africa |
| Salary | 3,800 GHS monthly (≈ $330) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | HND or diploma in administration |
| Application deadline | 2026-12-17 |
| Applicants so far | 231 |

Manage patient scheduling, records filing and supplier correspondence for a clinic group. You will be the calm point of contact on a busy reception desk and the reason the records are where they should be.

**Required skills:** Office administration · Records filing · English literacy · Scheduling

**Application requirements:** CV · Two references · Police clearance certificate

### 23. Cybersecurity Intern

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-023` |
| Company (fictional) | Nairobi Security Lab |
| Location | Nairobi, Kenya |
| Region | Africa |
| Salary | 25,000 KES monthly (≈ $193) |
| Employment type | Internship |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Final-year student or recent graduate in IT or cybersecurity |
| Application deadline | 2027-01-04 |
| Applicants so far | 204 |

Join a small security team for six months to help with phishing triage, asset inventories and vulnerability tracking. You will be given a mentor, real tasks and the time to learn why each one matters.

**Required skills:** Networking basics · Linux · Curiosity · Written documentation

**Application requirements:** CV · Transcript · A short statement of interest

### 24. WordPress Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-024` |
| Company (fictional) | Dar Digital Works |
| Location | Arusha, Tanzania |
| Region | Africa |
| Salary | 1,500,000 TZS monthly (≈ $578) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Equivalent experience accepted in place of a degree |
| Application deadline | 2027-01-02 |
| Applicants so far | 112 |

Maintain and extend WordPress sites for tourism and hospitality clients, from theme customisation to security updates. You will keep the sites fast on the connections their visitors actually have.

**Required skills:** WordPress · PHP · MySQL · Page speed optimisation · Elementor

**Application requirements:** CV · Two sites you built or maintain · Portfolio link

### 25. Remote Sales Representative

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AF-025` |
| Company (fictional) | Cairo Trade Partners |
| Location | Alexandria, Egypt |
| Region | Africa |
| Salary | 95 EGP hourly (≈ $1.9) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree preferred |
| Application deadline | 2027-01-08 |
| Applicants so far | 167 |

Sell a B2B logistics product into Gulf and North African markets by phone and email. You will build your own pipeline, and the commission is real from the first closed deal.

**Required skills:** B2B outbound sales · Arabic and English · CRM discipline · Negotiation

**Application requirements:** CV · A short call script you have used · Two references

## ASIA — 25 JOBS

### 1. Frontend Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-001` |
| Company (fictional) | Bengaluru Interface Co. |
| Location | Bengaluru, India |
| Region | Asia |
| Salary | 90,000 INR monthly (≈ $1,080) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree in computer science or equivalent portfolio |
| Application deadline | 2027-01-06 |
| Applicants so far | 412 |

Build the customer-facing screens of a subscription commerce platform in React, working from Figma designs inside a shared component library. You will own accessibility and loading behaviour, not just the happy path.

**Required skills:** React · TypeScript · CSS · Accessibility · Git

**Application requirements:** CV · GitHub or portfolio · One code sample

### 2. Backend Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-002` |
| Company (fictional) | Manila Stack Solutions |
| Location | Manila, Philippines |
| Region | Asia |
| Salary | 90,000 PHP monthly (≈ $1,550) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree in computer science or equivalent experience |
| Application deadline | 2027-01-10 |
| Applicants so far | 268 |

Develop and maintain services behind a workforce management product, in Node.js and PostgreSQL. You will own the schema for the modules you build and be on call for them during business hours.

**Required skills:** Node.js · PostgreSQL · REST API design · Docker · Testing

**Application requirements:** CV · Code sample · Technical interview

### 3. Virtual Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-003` |
| Company (fictional) | Singapore Support Guild Pte Ltd |
| Location | Singapore, Singapore |
| Region | Asia |
| Salary | 22 SGD hourly (≈ $16.9) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Diploma or degree preferred |
| Application deadline | 2026-12-23 |
| Applicants so far | 197 |

Support two executives with scheduling, travel and expense reconciliation across APAC time zones. You will be expected to anticipate the next three moves, not just complete the one you were given.

**Required skills:** Calendar management · Expense reporting · English · Discretion

**Application requirements:** CV · A short written task · References

### 4. Data Entry Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-004` |
| Company (fictional) | Kuala Lumpur Records Sdn Bhd |
| Location | Kuala Lumpur, Malaysia |
| Region | Asia |
| Salary | 28 MYR hourly (≈ $6.3) |
| Employment type | Internship |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | SPM or equivalent |
| Application deadline | 2026-12-15 |
| Applicants so far | 388 |

Enter and clean customer master data for a distribution business, checking each record against the source document. Duplicates are flagged for review, never deleted.

**Required skills:** Data entry · Excel · Bahasa and English · Attention to detail

**Application requirements:** CV · Data entry test · Two references

### 5. Online Research Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-005` |
| Company (fictional) | Tokyo Insight Partners K.K. |
| Location | Tokyo, Japan |
| Region | Asia |
| Salary | 1,800 JPY hourly (≈ $12.1) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or in progress |
| Application deadline | 2026-12-27 |
| Applicants so far | 143 |

Compile market research for clients entering the Japanese market, in Japanese and English. Every figure has to be traced to a published source, and anything estimated has to be labelled as such.

**Required skills:** Japanese and English · Research · Source verification · Excel

**Application requirements:** CV in Japanese or English · A sourced one-page summary · Availability across JST

### 6. AI Data Annotator

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-006` |
| Company (fictional) | Jakarta Label Collective |
| Location | Jakarta, Indonesia |
| Region | Asia |
| Salary | 45,000 IDR hourly (≈ $2.8) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | SMA or equivalent |
| Application deadline | 2026-12-18 |
| Applicants so far | 624 |

Annotate conversational text in Bahasa Indonesia and English for a customer-service model, following a 30-page rubric. Ambiguous cases are escalated with a written reason rather than decided silently.

**Required skills:** Bahasa Indonesia and English · Annotation tooling · Rubric consistency

**Application requirements:** CV · A 30-minute calibration task · Stable internet

### 7. Customer Service Representative

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-007` |
| Company (fictional) | Bangkok Connect Services |
| Location | Bangkok, Thailand |
| Region | Asia |
| Salary | 180 THB hourly (≈ $5.2) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Bachelor’s degree preferred |
| Application deadline | 2026-12-20 |
| Applicants so far | 342 |

Answer customer queries for a hospitality booking platform in Thai and English, across chat and email. You will own the booking problems you can fix and escalate the rest with a clear account of what happened.

**Required skills:** Thai and English · Booking systems · Complaint handling · Written communication

**Application requirements:** CV · A short phone screening · Shift availability

### 8. E-commerce Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-008` |
| Company (fictional) | Seoul Cart Co. Ltd |
| Location | Seoul, South Korea |
| Region | Asia |
| Salary | 14,000 KRW hourly (≈ $9.9) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | Bachelor’s degree or equivalent |
| Application deadline | 2026-12-29 |
| Applicants so far | 216 |

Keep product pages and stock accurate on a consumer electronics store, coordinating with suppliers on lead times. You will track which listings generate returns and fix the listings, not the returns policy.

**Required skills:** Korean and English · Product data accuracy · Excel · Coupang or Naver Smart Store

**Application requirements:** CV · A short note on a listing you would improve · Right to work in Korea

### 9. Content Writer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-009` |
| Company (fictional) | Ho Chi Minh Word Studio |
| Location | Ho Chi Minh City, Vietnam |
| Region | Asia |
| Salary | 240,000 VND hourly (≈ $9.5) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree in English, journalism or communications |
| Application deadline | 2027-01-05 |
| Applicants so far | 291 |

Write product guides and blog articles in English for a software client, working from briefs and developer interviews. Your work is edited by a human before publication, so the notes are part of the job.

**Required skills:** English writing · SEO basics · Technical research · Revision

**Application requirements:** CV · Three writing samples · A 300-word test brief

### 10. Graphic Designer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-010` |
| Company (fictional) | Mumbai Craft Studio |
| Location | Mumbai, India |
| Region | Asia |
| Salary | 550 INR hourly (≈ $6.6) |
| Employment type | Contract |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Degree or diploma in design, or a strong portfolio |
| Application deadline | 2027-01-02 |
| Applicants so far | 337 |

Design packaging and campaign artwork for a fast-moving consumer goods brand, working to a detailed brand guide. You will prepare print-ready files and check the proofs yourself before they go to the printer.

**Required skills:** Adobe Illustrator · Photoshop · Print production · Packaging design

**Application requirements:** CV · Portfolio (PDF or link) · Two references

### 11. UI/UX Designer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-011` |
| Company (fictional) | Singapore Pixel Labs Pte Ltd |
| Location | Singapore, Singapore |
| Region | Asia |
| Salary | 7,200 SGD monthly (≈ $5,520) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Degree in design or equivalent portfolio |
| Application deadline | 2027-01-12 |
| Applicants so far | 158 |

Design mobile flows for a regional banking app, working inside an established design system with a compliance review on every release. You will test with real users before you argue about the design.

**Required skills:** Figma · Interaction design · Usability testing · Accessibility

**Application requirements:** CV · Portfolio with process notes · Two references

### 12. Software QA Tester

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-012` |
| Company (fictional) | Pasig Quality Works |
| Location | Pasig, Philippines |
| Region | Asia |
| Salary | 42,000 PHP monthly (≈ $724) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or ISTQB certification |
| Application deadline | 2027-01-04 |
| Applicants so far | 203 |

Test a subscription billing platform for regressions before each release, writing the cases and the bug reports. You will be part of the go/no-go conversation, not just the queue that fills before it.

**Required skills:** Test case design · Playwright or Cypress · Jira · SQL basics

**Application requirements:** CV · Two examples of defect reports you wrote · Technical interview

### 13. Python Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-013` |
| Company (fictional) | Hyderabad Data Works |
| Location | Hyderabad, India |
| Region | Asia |
| Salary | 120,000 INR monthly (≈ $1,440) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree in computer science or equivalent experience |
| Application deadline | 2027-01-14 |
| Applicants so far | 364 |

Build ETL jobs and internal APIs for a healthcare analytics client, with strict handling rules on patient data. You will write the documentation your own teammates need, not the kind nobody reads.

**Required skills:** Python · SQL · Airflow · Pandas · API design

**Application requirements:** CV · GitHub or code sample · Two technical interviews

### 14. Social Media Manager

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-014` |
| Company (fictional) | Karachi Brand Wave |
| Location | Karachi, Pakistan |
| Region | Asia |
| Salary | 180,000 PKR monthly (≈ $645) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree in marketing or communications |
| Application deadline | 2027-01-07 |
| Applicants so far | 226 |

Run social channels for two consumer brands, in English and Urdu, from calendar to community replies. You will report monthly on what earned attention and what only looked busy.

**Required skills:** Copywriting · Instagram and Facebook · Community management · Reporting

**Application requirements:** CV · Writing samples · Two references

### 15. Digital Marketing Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-015` |
| Company (fictional) | Bangkok Growth Lab |
| Location | Chiang Mai, Thailand |
| Region | Asia |
| Salary | 65,000 THB monthly (≈ $1,880) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree in marketing or a related field |
| Application deadline | 2027-01-09 |
| Applicants so far | 149 |

Plan and run paid search and social campaigns for travel and hospitality clients, with budgets from 50,000 THB a month. You will test creative, measure cost per booking and defend the results in a monthly review.

**Required skills:** Google Ads · Meta Ads · Analytics · Creative testing

**Application requirements:** CV · A one-page campaign case study · Salary expectation

### 16. Online English Tutor

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-016` |
| Company (fictional) | Manila Language Bridge |
| Location | Cebu City, Philippines |
| Region | Asia |
| Salary | 480 PHP hourly (≈ $8.3) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Bachelor’s degree or in progress; TEFL preferred |
| Application deadline | 2026-12-21 |
| Applicants so far | 786 |

Teach conversational English to adult learners in 25-minute online sessions, mostly during Japanese and Korean evening hours. Lesson material is provided; the pacing and encouragement are yours.

**Required skills:** English fluency · Online teaching · Headset and stable internet · Patience

**Application requirements:** CV · A 10-minute demo lesson · Availability for evening shifts

### 17. SEO Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-017` |
| Company (fictional) | Chennai Search Works |
| Location | Chennai, India |
| Region | Asia |
| Salary | 85,000 INR monthly (≈ $1,020) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or equivalent experience |
| Application deadline | 2027-01-08 |
| Applicants so far | 271 |

Own technical SEO and content briefs for a SaaS client competing in US and UK search results. You will fix crawl and indexing problems, then measure whether the fix changed anything.

**Required skills:** Technical SEO · Ahrefs or Semrush · Google Search Console · Content briefs

**Application requirements:** CV · A short audit of any site · Technical interview

### 18. Transcription Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-018` |
| Company (fictional) | Dhaka Verbatim Services |
| Location | Dhaka, Bangladesh |
| Region | Asia |
| Salary | 420 BDT hourly (≈ $3.4) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | HSC or equivalent |
| Application deadline | 2026-12-19 |
| Applicants so far | 456 |

Transcribe interviews and meeting recordings in Bengali and English, following a verbatim style sheet with time markers. Unclear passages are marked rather than reconstructed from context.

**Required skills:** Bengali and English · Verbatim transcription · Time-stamping · Typing speed

**Application requirements:** CV · A two-minute timed transcription test · Stable internet

### 19. Mobile App Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-019` |
| Company (fictional) | Kuala Lumpur Apps Sdn Bhd |
| Location | Penang, Malaysia |
| Region | Asia |
| Salary | 9,500 MYR monthly (≈ $2,130) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree in computer science or equivalent experience |
| Application deadline | 2027-01-13 |
| Applicants so far | 92 |

Build features for a delivery app used by 40,000 riders, where battery use and data consumption are real constraints. You will profile on mid-range Android devices before you call anything done.

**Required skills:** Kotlin · Android Jetpack · REST APIs · Performance profiling

**Application requirements:** CV · App store links · Code sample

### 20. Data Analyst

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-020` |
| Company (fictional) | Jakarta Analytics Group |
| Location | Jakarta, Indonesia |
| Region | Asia |
| Salary | 18,000,000 IDR monthly (≈ $1,150) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Intermediate |
| Education | Bachelor’s degree in statistics, economics or computer science |
| Application deadline | 2027-01-06 |
| Applicants so far | 318 |

Build dashboards and weekly reports for a retail client with 60 outlets, turning messy point-of-sale data into decisions. You will be asked what the data cannot tell you, and expected to answer honestly.

**Required skills:** SQL · Python or R · Looker Studio or Power BI · Excel

**Application requirements:** CV · A dashboard or analysis you built · Technical interview

### 21. Technical Support Agent

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-021` |
| Company (fictional) | Osaka Cloud Support K.K. |
| Location | Osaka, Japan |
| Region | Asia |
| Salary | 1,500 JPY hourly (≈ $10.1) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree or IT certification |
| Application deadline | 2027-01-05 |
| Applicants so far | 187 |

Support business customers running a SaaS platform, primarily in Japanese with some English. You will reproduce the fault before escalating it and write the resolution into the shared knowledge base.

**Required skills:** Japanese and English · SaaS troubleshooting · Network basics · Ticketing systems

**Application requirements:** CV in Japanese · A troubleshooting scenario test · Shift availability

### 22. AI Model Evaluator

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-022` |
| Company (fictional) | Seoul Alignment Labs |
| Location | Seoul, South Korea |
| Region | Asia |
| Salary | 18,000 KRW hourly (≈ $12.7) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or equivalent demonstrated work |
| Application deadline | 2027-01-11 |
| Applicants so far | 134 |

Evaluate model responses in Korean and English against a safety and accuracy rubric, writing a rationale for every score. The most useful thing you will do is find the cases the rubric forgets.

**Required skills:** Korean and English · Rubric evaluation · Analytical writing · Bias awareness

**Application requirements:** CV · A five-item evaluation test · Signed data-handling acknowledgement

### 23. Administrative Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-023` |
| Company (fictional) | Manila Clinic Partners |
| Location | Quezon City, Philippines |
| Region | Asia |
| Salary | 26,000 PHP monthly (≈ $448) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | Bachelor’s degree or associate diploma |
| Application deadline | 2026-12-17 |
| Applicants so far | 402 |

Support a clinic group with patient scheduling, filing and supplier correspondence across two sites. You will keep the records accurate and the front desk calm during the busiest hours.

**Required skills:** Office administration · Records filing · English and Tagalog · Scheduling

**Application requirements:** CV · Two references · Police clearance

### 24. Video Editor

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-024` |
| Company (fictional) | Hanoi Motion Studio |
| Location | Hanoi, Vietnam |
| Region | Asia |
| Salary | 240,000 VND hourly (≈ $9.5) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Equivalent experience accepted in place of a degree |
| Application deadline | 2027-01-03 |
| Applicants so far | 231 |

Edit short-form social video for clients in food and hospitality, from supplied footage to finished captioned cuts. You will work to a brand style and deliver on a two-day turnaround.

**Required skills:** Premiere Pro · CapCut · Subtitle workflows · Colour basics

**Application requirements:** CV · Showreel · A short test edit

### 25. WordPress Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AS-025` |
| Company (fictional) | Pune Web Foundry |
| Location | Pune, India |
| Region | Asia |
| Salary | 70,000 INR monthly (≈ $840) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Degree or demonstrable portfolio |
| Application deadline | 2027-01-04 |
| Applicants so far | 289 |

Maintain and extend WordPress sites for a portfolio of small business clients, including security hardening and speed work. You will be the person who notices a slow site before the client complains.

**Required skills:** WordPress · PHP · MySQL · Performance optimisation · Security basics

**Application requirements:** CV · Two sites you maintain · Portfolio link

## AMERICAS — 25 JOBS

### 1. Junior Data Analyst

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-001` |
| Company (fictional) | Cedarline Analytics LLC |
| Location | Austin, TX, United States |
| Region | Americas |
| Salary | 26 USD hourly (≈ $26) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | Bachelor’s degree in statistics, economics or a related field |
| Application deadline | 2027-01-08 |
| Applicants so far | 218 |

Support a small analytics team with reporting and ad-hoc queries for retail clients, starting from clean exports and ending with a chart someone can act on. You will be taught the warehouse model in your first month.

**Required skills:** SQL · Excel · Data visualisation · Clear written summaries

**Application requirements:** CV · A short analysis exercise · Right to work in the US

### 2. IT Support Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-002` |
| Company (fictional) | Northbridge Systems Inc. |
| Location | Columbus, OH, United States |
| Region | Americas |
| Salary | 27 USD hourly (≈ $27) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Intermediate |
| Education | Associate degree or CompTIA A+ certification |
| Application deadline | 2027-01-02 |
| Applicants so far | 164 |

Provide first and second-line support for 300 staff across four sites, from device provisioning to account administration. You will keep the asset register current and write the fix into the knowledge base.

**Required skills:** Windows and macOS · Active Directory · Networking basics · Ticketing systems

**Application requirements:** CV · Certification proof if held · Right to work in the US

### 3. Virtual Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-003` |
| Company (fictional) | Maple Grove Assist Inc. |
| Location | Toronto, ON, Canada |
| Region | Americas |
| Salary | 24 CAD hourly (≈ $17.5) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | College diploma or equivalent |
| Application deadline | 2026-12-22 |
| Applicants so far | 287 |

Manage inbox, calendar and client follow-ups for a two-person immigration consultancy with a busy caseload. You will keep the files complete and the deadlines visible, in English and French.

**Required skills:** Calendar management · English and French · Google Workspace · Document management

**Application requirements:** CV in English or French · A short written task · Availability across EST

### 4. AI Model Evaluator

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-004` |
| Company (fictional) | Blue Harbor AI Research Corp. |
| Location | Seattle, WA, United States |
| Region | Americas |
| Salary | 34 USD hourly (≈ $34) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or equivalent demonstrated work |
| Application deadline | 2027-01-11 |
| Applicants so far | 342 |

Score model outputs on factual accuracy, refusal behaviour and tone against a written rubric, and write the rationale behind every score. Half the value is spotting where the rubric has no answer.

**Required skills:** Analytical writing · Rubric evaluation · Prompt testing · Bias awareness

**Application requirements:** CV · A five-item evaluation test · Signed data-handling acknowledgement

### 5. Social Media Manager

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-005` |
| Company (fictional) | Vista Norte Marketing S.A. de C.V. |
| Location | Mexico City, Mexico |
| Region | Americas |
| Salary | 240 MXN hourly (≈ $13.2) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree in marketing or communications |
| Application deadline | 2027-01-05 |
| Applicants so far | 236 |

Run social channels for three consumer brands in Spanish and English, from calendar to community replies to the monthly report. You will handle the complaints in public as well as the launches.

**Required skills:** Spanish and English copywriting · Instagram and TikTok · Community management · Reporting

**Application requirements:** CV in Spanish or English · Writing samples · Two references

### 6. Graphic Designer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-006` |
| Company (fictional) | Pampa Creative Studio SAS |
| Location | Bogotá, Colombia |
| Region | Americas |
| Salary | 32,000 COP hourly (≈ $8.4) |
| Employment type | Contract |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Degree or diploma in design, or a strong portfolio |
| Application deadline | 2027-01-03 |
| Applicants so far | 198 |

Design campaign and packaging artwork for food and beverage clients, working to supplied brand guidelines. You will prepare print-ready files and check the proofs before anything goes to press.

**Required skills:** Adobe Illustrator · Photoshop · Print production · Brand systems

**Application requirements:** CV · Portfolio (PDF or link) · Two references

### 7. SEO Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-007` |
| Company (fictional) | Lakeshore Search Partners |
| Location | Vancouver, BC, Canada |
| Region | Americas |
| Salary | 36 CAD hourly (≈ $26.2) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or equivalent experience |
| Application deadline | 2027-01-09 |
| Applicants so far | 176 |

Own organic growth for a B2B software client across Canada and the US, from technical fixes to content briefs. You will report on what changed in the rankings and why you think it changed.

**Required skills:** Technical SEO · Ahrefs or Semrush · Search Console · Content strategy

**Application requirements:** CV · A short site audit · Two references

### 8. Customer Support Representative

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-008` |
| Company (fictional) | Sunbelt Home Services LLC |
| Location | Phoenix, AZ, United States |
| Region | Americas |
| Salary | 21 USD hourly (≈ $21) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Entry-level |
| Education | High school diploma |
| Application deadline | 2026-12-20 |
| Applicants so far | 401 |

Handle inbound customer queries for a home-services network in English and Spanish, across phone and chat. You will resolve scheduling problems on the spot and escalate the rest with a clear record.

**Required skills:** English and Spanish · Customer service · Scheduling systems · Written communication

**Application requirements:** CV · A short phone screening · Availability for weekend rota

### 9. Software Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-009` |
| Company (fictional) | Pacífico Software Ltda. |
| Location | São Paulo, Brazil |
| Region | Americas |
| Salary | 95 BRL hourly (≈ $17.6) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree in computer science or equivalent experience |
| Application deadline | 2027-01-13 |
| Applicants so far | 129 |

Build and maintain the services behind a payments product used by small merchants, in Java and PostgreSQL. You will own your services in production, including the alerts that wake you up.

**Required skills:** Java or Kotlin · PostgreSQL · REST APIs · Docker · Observability

**Application requirements:** CV · GitHub or code sample · Two technical interviews

### 10. Data Entry Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-010` |
| Company (fictional) | Great Lakes Records Corp. |
| Location | Detroit, MI, United States |
| Region | Americas |
| Salary | 19 USD hourly (≈ $19) |
| Employment type | Contract |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | High school diploma |
| Application deadline | 2026-12-16 |
| Applicants so far | 312 |

Enter and reconcile supplier records into a procurement system, checking each entry against the scanned source. Duplicates are flagged for review rather than deleted, and accuracy is sampled weekly.

**Required skills:** Data entry · Excel · Attention to detail · Typing speed above 45 wpm

**Application requirements:** CV · An accuracy test · Right to work in the US

### 11. Digital Marketing Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-011` |
| Company (fictional) | Andes Growth SpA |
| Location | Santiago, Chile |
| Region | Americas |
| Salary | 9,500 CLP hourly (≈ $10.1) |
| Employment type | Internship |
| Work arrangement | Hybrid |
| Experience level | Entry-level |
| Education | Bachelor’s degree in marketing or a related field |
| Application deadline | 2026-12-27 |
| Applicants so far | 263 |

Support paid campaigns and email marketing for retail clients, building the assets and tracking the spend. You will learn to read a dashboard before you are asked to justify a budget.

**Required skills:** Meta Ads Manager · Email marketing · Excel · Spanish and English

**Application requirements:** CV · A sample campaign you built · Two references

### 12. Content Writer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-012` |
| Company (fictional) | Harbour Line Media Inc. |
| Location | Halifax, NS, Canada |
| Region | Americas |
| Salary | 32 CAD hourly (≈ $23.3) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree in journalism, English or communications |
| Application deadline | 2027-01-06 |
| Applicants so far | 211 |

Write long-form guides and case studies for a software client, working from developer interviews and product documentation. Every claim is fact-checked, so your sourcing matters as much as your prose.

**Required skills:** Long-form English writing · Technical research · SEO fundamentals · Editing

**Application requirements:** CV · Three published samples · A 300-word test brief

### 13. Online Research Assistant

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-013` |
| Company (fictional) | Mercado Insights SAC |
| Location | Lima, Peru |
| Region | Americas |
| Salary | 30 PEN hourly (≈ $8) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Bachelor’s degree in progress or completed |
| Application deadline | 2026-12-24 |
| Applicants so far | 189 |

Compile verified competitor and pricing data for consulting clients entering Peruvian and Andean markets. Every figure is cited to a page you actually opened, and estimates are labelled as estimates.

**Required skills:** Web research · Source citation · Spanish and English · Excel

**Application requirements:** CV · A sourced one-page market summary · Weekly availability

### 14. Cybersecurity Analyst

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-014` |
| Company (fictional) | Ironwood Security Group LLC |
| Location | Denver, CO, United States |
| Region | Americas |
| Salary | 48 USD hourly (≈ $48) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree or CISSP/Security+ certification |
| Application deadline | 2027-01-12 |
| Applicants so far | 97 |

Monitor alerts, triage incidents and run the investigation for a managed-security client base. You will write the incident report a non-technical executive can act on, which is often the harder half.

**Required skills:** SIEM · Incident response · Networking · Scripting (Python or PowerShell)

**Application requirements:** CV · Certification proof · On-call availability

### 15. Python Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-015` |
| Company (fictional) | Tequila Data Labs S.A. de C.V. |
| Location | Guadalajara, Mexico |
| Region | Americas |
| Salary | 480 MXN hourly (≈ $26.4) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree in computer science or equivalent experience |
| Application deadline | 2027-01-14 |
| Applicants so far | 118 |

Build ingestion pipelines and internal tools for a manufacturing analytics client, in Python and Django. You will work close to the factory data, which is messier than any sample dataset suggests.

**Required skills:** Python · Django · SQL · Docker · Data pipelines

**Application requirements:** CV · GitHub or code sample · Technical interview

### 16. UI/UX Designer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-016` |
| Company (fictional) | Cascade Product Studio |
| Location | Portland, OR, United States |
| Region | Americas |
| Salary | 62 USD hourly (≈ $62) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Experienced |
| Education | Degree in design or a strong portfolio |
| Application deadline | 2027-01-10 |
| Applicants so far | 143 |

Design flows for a healthcare scheduling product under real accessibility constraints, working with an existing design system. You will run usability sessions with patients and let the results settle the arguments.

**Required skills:** Figma · Usability testing · Accessibility (WCAG 2.2) · Design systems

**Application requirements:** CV · Portfolio with process notes · Two references

### 17. Project Coordinator

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-017` |
| Company (fictional) | Rio Construction Management Ltda. |
| Location | Rio de Janeiro, Brazil |
| Region | Americas |
| Salary | 55 BRL hourly (≈ $10.2) |
| Employment type | Full-time |
| Work arrangement | Onsite |
| Experience level | Intermediate |
| Education | Bachelor’s degree in engineering, construction or business |
| Application deadline | 2027-01-04 |
| Applicants so far | 87 |

Coordinate schedules, suppliers and site documentation for three residential fit-out projects. You will keep the tracker honest, which sometimes means telling the client the date has moved.

**Required skills:** Project tracking · Portuguese and English · Supplier coordination · Excel

**Application requirements:** CV in Portuguese · A project you coordinated · Two references

### 18. Transcription Specialist

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-018` |
| Company (fictional) | Bayou Verbatim Services LLC |
| Location | New Orleans, LA, United States |
| Region | Americas |
| Salary | 22 USD hourly (≈ $22) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Entry-level |
| Education | Associate degree; terminology training welcome |
| Application deadline | 2026-12-18 |
| Applicants so far | 276 |

Transcribe recorded legal and medical interviews, following a strict verbatim style with time markers. Inaudible passages are marked, never reconstructed, and files are spot-checked against the audio.

**Required skills:** Verbatim transcription · Legal or medical terminology · Time-stamping · Confidentiality

**Application requirements:** CV · A two-minute timed transcription test · Confidentiality agreement

### 19. E-commerce Manager

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-019` |
| Company (fictional) | Costa Verde Comercio S.A. |
| Location | San José, Costa Rica |
| Region | Americas |
| Salary | 14,000 CRC hourly (≈ $26.6) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree in business, marketing or a related field |
| Application deadline | 2027-01-07 |
| Applicants so far | 74 |

Own the online store for a consumer goods brand: merchandising, pricing, promotions and the customer journey end to end. You will be measured on conversion and repeat purchase, not on page views.

**Required skills:** Shopify · Conversion optimisation · Analytics · Spanish and English · Promotions

**Application requirements:** CV · A store you managed and its results · Two references

### 20. Technical Support Agent

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-020` |
| Company (fictional) | Maple Cloud Support Inc. |
| Location | Montreal, QC, Canada |
| Region | Americas |
| Salary | 30 CAD hourly (≈ $21.9) |
| Employment type | Full-time |
| Work arrangement | Hybrid |
| Experience level | Intermediate |
| Education | Bachelor’s degree or vendor certification |
| Application deadline | 2027-01-08 |
| Applicants so far | 158 |

Support business customers on a managed cloud platform in English and French, taking the escalations other teams cannot close. You will reproduce the fault and document the fix before you route it.

**Required skills:** Linux · Networking · English and French · Incident reproduction

**Application requirements:** CV · An escalation scenario test · French or English interview

### 21. AI Data Trainer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-021` |
| Company (fictional) | Pampas AI Collective SAS |
| Location | Buenos Aires, Argentina |
| Region | Americas |
| Salary | 3,800 ARS hourly (≈ $3.2) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree or equivalent experience |
| Application deadline | 2027-01-09 |
| Applicants so far | 224 |

Write and grade Spanish-language training prompts for a conversational model, applying a detailed quality rubric. You will spend most of your time explaining precisely why an answer is wrong.

**Required skills:** Spanish fluency · Prompt writing · Rubric evaluation · Written rationales

**Application requirements:** CV · A five-item evaluation test · Signed data-handling acknowledgement

### 22. Video Editor

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-022` |
| Company (fictional) | Mesa Motion Studio LLC |
| Location | Albuquerque, NM, United States |
| Region | Americas |
| Salary | 28 USD hourly (≈ $28) |
| Employment type | Contract |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Equivalent experience accepted in place of a degree |
| Application deadline | 2027-01-02 |
| Applicants so far | 193 |

Edit short-form video for social campaigns and client case studies, from rough cut to finished captions. You will work from supplied footage and to a brand style, with a two-day turnaround.

**Required skills:** Premiere Pro · After Effects · Subtitle workflows · Colour basics

**Application requirements:** CV · Showreel · A short test edit

### 23. WordPress Developer

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-023` |
| Company (fictional) | Prairie Web Works Ltd. |
| Location | Winnipeg, MB, Canada |
| Region | Americas |
| Salary | 38 CAD hourly (≈ $27.7) |
| Employment type | Full-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | College diploma or demonstrable portfolio |
| Application deadline | 2027-01-05 |
| Applicants so far | 137 |

Maintain and extend WordPress sites for a portfolio of small business clients, including security patches and speed work. You will be the person who fixes the site before the client notices it was slow.

**Required skills:** WordPress · PHP · MySQL · Performance optimisation · Security basics

**Application requirements:** CV · Two sites you maintain · Portfolio link

### 24. Online Tutor

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-024` |
| Company (fictional) | Bright Range Learning LLC |
| Location | Remote (US), United States |
| Region | Americas |
| Salary | 27 USD hourly (≈ $27) |
| Employment type | Part-time |
| Work arrangement | Remote |
| Experience level | Intermediate |
| Education | Bachelor’s degree in mathematics, education or a related subject |
| Application deadline | 2026-12-25 |
| Applicants so far | 366 |

Teach mathematics to middle and high school students online, in small groups and one-to-one sessions. You will set the weekly practice and mark it, so progress is visible to the families paying for it.

**Required skills:** Mathematics up to pre-calculus · Online teaching · Lesson planning · Clear communication

**Application requirements:** CV · A 15-minute demo lesson · Background check consent

### 25. Business Analyst

| Field | Value |
|---|---|
| Reference ID | `SAMPLE-AM-025` |
| Company (fictional) | Keystone Process Advisors LLC |
| Location | Philadelphia, PA, United States |
| Region | Americas |
| Salary | 46 USD hourly (≈ $46) |
| Employment type | Contract |
| Work arrangement | Hybrid |
| Experience level | Experienced |
| Education | Bachelor’s degree; IIBA certification an advantage |
| Application deadline | 2027-01-11 |
| Applicants so far | 81 |

Map how a healthcare payer processes claims, then write the requirements for the system replacing it. You will sit between operations and engineering and translate in both directions.

**Required skills:** Process mapping · BPMN · Stakeholder facilitation · Requirements documentation

**Application requirements:** CV · Two examples of requirements you authored · Right to work in the US
