/**
 * The advanced half of the built-in assessment bank.
 *
 * Ten additional questions per category, written as applied scenarios rather than vocabulary
 * recall. Several carry a figure so the assessment also tests visual judgement. The answer key and
 * explanations live only on the server; the browser receives the public projection.
 */

export type RawBankQuestion = {
  q: string
  opts: string[]
  ans: number
  img?: string
  alt?: string
  why?: string
}

export const EXTRA_BANKS: Record<string, RawBankQuestion[]> = {
  Transcription: [
    {
      q: "A call has two main speakers and a third participant who says only “mm-hm” twice. The brief asks for all speakers. How should the third participant appear?",
      opts: [
        "Merge their sounds into the main speaker's line",
        "Give them a consistent speaker label and a new line at each contribution",
        "Delete the sounds because they add no meaning",
        "Add them as a footnote after the transcript",
      ],
      ans: 1,
      why: "If the brief asks for all speakers, every voice gets a label and its own line. Merging hides a participant; deleting removes evidence.",
    },
    {
      q: "A 45-minute interview has no timestamp instruction beyond “add timestamps”. What is the strongest default?",
      opts: [
        "Only put a timestamp at the beginning and end",
        "Put one at the start and at speaker or topic changes, using a consistent interval",
        "Put one on every single line",
        "Skip timestamps because none were specified precisely",
      ],
      ans: 1,
      why: "Start plus meaningful changes is the useful default. It gives a reviewer navigation without turning the transcript into a wall of numbers.",
    },
    {
      q: "You hear a surname that could be “Mwikali” or “Mwikalli”. The brief lists three approved spellings but neither of these. What is the professional move?",
      opts: [
        "Choose the spelling that looks most common in Kenya",
        "Use the closest approved spelling and move on",
        "Tag the uncertainty or ask the project lead, then record the decision",
        "Invent a phonetic spelling and mark it final",
      ],
      ans: 2,
      why: "A name is a fact. When the approved list does not settle it, the honest output is a tag or a targeted question, not a confident guess.",
    },
    {
      q: "The brief says “clean verbatim”. Which change is allowed?",
      opts: [
        "Remove filler sounds and false starts while preserving every idea",
        "Correct the speaker's grammar so the transcript reads better",
        "Replace unclear words with likely alternatives",
        "Merge short speaker turns to make the conversation flow",
      ],
      ans: 0,
      why: "Clean verbatim removes verbal clutter, not meaning, grammar or speaker structure. The speaker's ideas and turns must survive.",
    },
    {
      q: "The audio drops out for eight seconds during a sentence. The speaker is clearly mid-thought when it returns. What should the transcript show?",
      opts: [
        "A guessed continuation that makes the sentence grammatical",
        "An approved silence or audio-cut tag with the approximate timestamp, then continue with what is audible",
        "Nothing at all, so the reader does not notice",
        "A note saying the recording is unusable",
      ],
      ans: 1,
      why: "A timestamped tag preserves the gap and its location. A guess invents evidence; silence hides it.",
    },
    {
      q: "Two speakers overlap at 12:04. One is giving a payment amount; the other is saying “no, wait”. What is the best transcript?",
      opts: [
        "Keep only the louder payment amount",
        "Keep only the objection because it changes the decision",
        "Transcribe both audible contributions and mark the overlap with the brief's crosstalk convention",
        "Write [crosstalk] and skip the whole section",
      ],
      ans: 2,
      why: "Both contributions matter. The tag explains why the lines are hard to follow; dropping one changes the record.",
    },
    {
      q: "A recording contains a patient's name, diagnosis and appointment time. The client asks you to “run it through a quick online transcriber” to save time. What should you do?",
      opts: [
        "Upload it because the client asked",
        "Upload only the first five minutes",
        "Keep it inside the approved tool and ask the client to confirm any external tool is permitted and compliant",
        "Rename the file before uploading",
      ],
      ans: 2,
      why: "Client instruction does not override confidentiality or the approved processing boundary. A renamed file is still the same sensitive data.",
    },
    {
      q: "The client permits AI-assisted transcription but requires a human-verified final file. What is the correct workflow?",
      opts: [
        "Submit the AI draft unchanged because the client allowed AI",
        "Use the draft as a starting point and verify every speaker turn, name, number and tag against the audio",
        "Use AI only for the first half and transcribe the rest by hand",
        "Ask the AI to invent tags for anything it cannot hear",
      ],
      ans: 1,
      why: "Permission changes the starting point, not the standard. The human verifies the final record and owns its accuracy.",
    },
    {
      q: "QA returns a transcript with the note “speaker labels inconsistent after 00:18”. What is the strongest prevention step?",
      opts: [
        "Fix only the lines named in the note",
        "Recheck the speaker map at every label change and add a label-consistency pass to the workflow",
        "Remove all speaker labels to avoid future complaints",
        "Ask QA to relabel the file for you",
      ],
      ans: 1,
      why: "The note points to a workflow gap, not one bad line. A speaker-map check prevents the same error in the next file.",
    },
    {
      q: "Look at the transcript excerpt. Which problem would a QA reviewer return first?",
      opts: [
        "The timestamps are too frequent",

        "Two speakers share one paragraph and an unclear amount was silently guessed",
        "The speaker labels are too formal",
        "The text contains too many full stops",
      ],
      ans: 1,
      img: "/training/transcription-quality.svg",
      alt: "A pass-versus-fix transcript comparison: the fix panel merges two speakers into one paragraph and leaves an unclear total untagged.",
      why: "Speaker ownership and faithful uncertain values are the first checks. Formatting preferences come after the record is structurally sound.",
    },
  ],
  "Data Entry": [
    {
      q: "A receipt shows a printed total of 8,400 and a tax line of 800, but the item lines add to 7,500. The brief says to copy the printed total. What do you enter?",
      opts: [
        "7,500, because the line items are the real sum",
        "8,400, the printed total, and note the discrepancy if the brief asks",
        "7,600, the line items plus tax",
        "Leave the total blank",
      ],
      ans: 1,
      why: "The printed total is the source value the brief names. Correcting it hides the discrepancy from the client.",
    },
    {
      q: "A form shows 03/04/2026 with no country or language marker. The brief says the source is from a US office. How do you interpret it?",
      opts: [
        "3 April 2026, because day-first is common in Kenya",
        "4 March 2026, following the source locale's month-first convention, unless the brief says otherwise",
        "Choose either date; the difference does not matter",
        "Leave the date blank without a note",
      ],
      ans: 1,
      why: "Use the source's documented locale and the brief's rule. If the evidence is still genuinely ambiguous, flag it rather than silently choosing.",
    },
    {
      q: "A handwritten digit could be a zero or the letter O. The field expects a number, but the scan is poor. What is the correct action?",
      opts: [
        "Enter 0 because the field is numeric",
        "Enter O because that is what it looks like",
        "Use the brief's unclear status or request a better copy, and note the field",
        "Delete the row",
      ],
      ans: 2,
      why: "A poor scan is an exception, not a prompt to guess. The row can continue with an approved status while the uncertain field stays traceable.",
    },
    {
      q: "Two receipts have the same merchant, date and amount. Before deciding whether one is a duplicate, what should you compare?",
      opts: [
        "Only the merchant name",
        "The receipt number, time, payment method and source page as well",
        "The color of the receipt paper",
        "Nothing; identical amounts are always duplicates",
      ],
      ans: 1,
      why: "A genuine second purchase can look identical at first glance. Reference numbers and source context distinguish a duplicate from a real transaction.",
    },
    {
      q: "After entering 20 rows, you discover the “shipping address” column was mapped to billing address. What is the best recovery?",
      opts: [
        "Continue and fix only the last row",
        "Stop, fix the mapping, identify every affected row, correct them, and verify a sample before continuing",
        "Delete the batch and start the whole project over",
        "Add a note and submit without correcting the rows",
      ],
      ans: 1,
      why: "A systematic mapping error affects every row after the mistake. Fix the cause, correct the known scope, and verify before moving on.",
    },
    {
      q: "A source phone number is written as 0712 345 678. The brief asks for E.164 format but does not mention a country code. What should you do?",
      opts: [
        "Invent +254 because the business is in Kenya",
        "Follow the project's documented country assumption if one exists; otherwise flag the missing country code",
        "Remove the leading zero and submit 712345678",
        "Leave the field exactly as written and ignore the format rule",
      ],
      ans: 1,
      why: "Format rules can require transformation, but a country code is a fact. Use a documented assumption or flag it; do not invent the prefix.",
    },
    {
      q: "A batch contains invoices in KES and USD. The column dictionary has separate amount and currency fields. What is the correct entry?",
      opts: [
        "Convert every amount to USD so the column is consistent",
        "Record each amount with its own currency; convert only if the brief explicitly asks",
        "Put both currencies in the amount field",
        "Use the KES amount for every invoice",
      ],
      ans: 1,
      why: "The source amount and currency are the facts. Conversion is a separate instruction with its own rate and rounding rules.",
    },
    {
      q: "A three-page invoice is missing page two. What should you do with the rows from page three?",
      opts: [
        "Infer the missing rows from the totals",
        "Enter page three only, mark the missing page, and report the gap",
        "Skip the whole invoice without telling anyone",
        "Enter page three and pretend it is complete",
      ],
      ans: 1,
      why: "You can transcribe what is present, but the missing page is a material gap. Reporting it protects the client from a silently incomplete record.",
    },
    {
      q: "Look at the source-to-row diagram. Which item belongs in the exception queue rather than the final row?",
      opts: [
        "A clearly printed merchant name",
        "A total that contradicts both the printed total and the tax line, with no brief rule",
        "A date that already matches the required format",
        "A blank marketing field that the brief excludes",
      ],
      ans: 1,
      img: "/training/data-entry-capstone.svg",
      alt: "Source documents flowing into a row template, with a validation gate and an exception queue for ambiguous values.",
      why: "The brief does not resolve the contradiction, so the value needs a human decision. The other examples are either unambiguous or out of scope.",
    },
    {
      q: "An AI tool offers to extract all fields from a client PDF. The client has not approved external tools. What is the correct response?",
      opts: [
        "Use it anyway because extraction is faster",
        "Use it on a screenshot instead of the PDF",
        "Do not upload the document; extract manually or ask the client about an approved tool",
        "Upload it and delete the chat history afterwards",
      ],
      ans: 2,
      why: "The client's approval boundary applies to the data, not the file format. Deleting a chat does not undo an unauthorised disclosure.",
    },
  ],
  "Image Labeling": [
    {
      q: "A pedestrian is 40% hidden behind a delivery van. The taxonomy says to box visible pixels. Where should the box go?",
      opts: [
        "Around the full estimated body, including the hidden part",
        "Tightly around the visible head, arm and leg only",
        "Around the whole van as context",
        "Nowhere; occluded objects are always skipped",
      ],
      ans: 1,
      why: "The visible-pixel rule keeps the label honest. Inventing the hidden body creates pixels the model cannot learn from.",
    },
    {
      q: "A car is cut off by the right edge of the frame, with only its front half visible. What is the best action?",
      opts: [
        "Skip it because the whole object is not visible",
        "Box the visible half and follow the brief's truncation rule",
        "Draw the box past the edge to represent the missing half",
        "Label it as a motorcycle because the back is missing",
      ],
      ans: 1,
      why: "Truncation is a normal edge case. The brief decides whether partially visible objects are included; the box still follows visible pixels.",
    },
    {
      q: "One object could be a car or a van. The taxonomy definitions overlap and the example gallery has no matching image. What should you do?",
      opts: [
        "Choose the class you use most often",
        "Use the closest class and never mention the ambiguity",
        "Escalate to the specified unsure path or ask for an adjudication rule",
        "Create a new class called car-van",
      ],
      ans: 2,
      why: "A genuine taxonomy gap is a project issue, not a personal guess. Escalation keeps the batch consistent and gives the client a chance to clarify.",
    },
    {
      q: "A traffic sign is only eight pixels wide. The brief gives a minimum object size for annotation. What is the correct action?",
      opts: [
        "Box it anyway because every sign matters",
        "Follow the minimum-size rule; if it is below the threshold, mark it ignored or unsure as instructed",
        "Enlarge the image until the sign is readable",
        "Label it as a pedestrian",
      ],
      ans: 1,
      why: "The minimum-size rule exists because tiny boxes are unreliable. Follow the brief instead of forcing a label the model cannot learn from.",
    },
    {
      q: "Two annotators draw different boxes for the same cyclist. What is the most useful next step?",
      opts: [
        "Average the two boxes",
        "Review the taxonomy and examples together, then adjudicate the disagreement and record the rule",
        "Delete both annotations",
        "Keep the larger box because it includes more information",
      ],
      ans: 1,
      why: "Disagreement is a signal about an unclear rule. Adjudication plus a recorded decision improves the next batch; averaging hides the ambiguity.",
    },
    {
      q: "A box around a dog includes the road, a shadow and a nearby bench. What is wrong?",
      opts: [
        "Nothing; context helps the model",
        "The box is not tight to the visible dog, so it teaches the model the wrong pixels",
        "The box is too small",
        "The class should be bench",
      ],
      ans: 1,
      why: "A bounding box is a promise about the object's pixels. Loose boxes introduce background as positive evidence.",
    },
    {
      q: "You accidentally draw two identical boxes on the same car. The brief says one annotation per object. What should you do?",
      opts: [
        "Keep both; more boxes mean more data",
        "Delete the duplicate and verify that no other object was missed",
        "Change one duplicate to a different class",
        "Leave it for QA to decide",
      ],
      ans: 1,
      why: "Duplicate boxes double-count the object and distort the dataset. Remove the duplicate and use the pass to check for genuinely missed objects.",
    },
    {
      q: "A model pre-label is already on the image. The client permits pre-labels. What is the correct workflow?",
      opts: [
        "Accept every pre-label without checking",
        "Delete all pre-labels and start from zero",
        "Check each pre-label against the taxonomy, fix or remove errors, and add missed objects",
        "Only check the largest boxes",
      ],
      ans: 2,
      why: "A pre-label is a draft. The annotator still verifies class, tightness, duplicates and missed objects before submitting.",
    },
    {
      q: "Look at the three annotation panels. Which verdict is correct for the occluded pedestrian?",
      opts: [
        "A: box the full imagined body",
        "B: box only the visible pixels and stop at the occlusion",
        "C: skip the object entirely",
        "All three are equally acceptable",
      ],
      ans: 1,
      img: "/training/labeling-boxes.svg",
      alt: "Three annotation panels showing a tight box, a loose box and an occluded object with only visible pixels boxed.",
      why: "The visible-pixel rule is the only defensible choice when the hidden body is unknown. Tightness and truncation rules keep the label honest.",
    },
    {
      q: "You finish 30 images and notice your first ten used “vehicle” while the rest use “car”. What is the best correction?",
      opts: [
        "Leave the difference; both words mean the same thing",
        "Check the taxonomy, pick the approved class, and make the whole batch consistent",
        "Rename every car to vehicle even if the taxonomy has separate classes",
        "Submit and let the client decide",
      ],
      ans: 1,
      why: "Class names come from the taxonomy, not personal vocabulary. Batch consistency is part of annotation quality.",
    },
  ],
  "Content Review": [
    {
      q: "Two friends exchange a violent-sounding joke, with laughing reactions and no target. Policy does not list jokes as a violation. What is the best decision?",
      opts: [
        "Remove it automatically because the words are violent",
        "Apply the context and credibility rules, document the decision, and escalate if the threat could be credible",
        "Ignore it without a note",
        "Ban both accounts immediately",
      ],
      ans: 1,
      why: "Context and credibility matter. A documented decision protects both the user and the reviewer; automatic removal ignores policy nuance.",
    },
    {
      q: "A post claims a common medicine cures a serious disease and tells readers to stop prescribed treatment. What is the strongest response?",
      opts: [
        "Leave it because health opinions are allowed",
        "Treat it as high-severity medical misinformation, remove or restrict it under policy, and escalate",
        "Reply with a correction and leave the post up",
        "Ask the author to add a disclaimer",
      ],
      ans: 1,
      why: "Immediate physical harm raises severity. Policy enforcement and escalation take priority over debate or cosmetic disclaimers.",
    },
    {
      q: "A reclaimed slur appears inside a community that uses it affectionately. Policy allows reclaimed use without a targeted attack. What should you do?",
      opts: [
        "Remove every use of the word",
        "Review the target, intent and context; allow it if it meets the reclaimed-use rule, and document why",
        "Escalate automatically because the word is always banned",
        "Ignore the post without reading the context",
      ],
      ans: 1,
      why: "The same word can be a reclaimed term or an attack. The policy's context rule is what separates them.",
    },
    {
      q: "A rights-holder complains that a post copies their photo, but there is no formal copyright notice. What is the correct route?",
      opts: [
        "Delete the post immediately based on the complaint",
        "Route it through the formal copyright process rather than making a proactive legal decision",
        "Tell the rights-holder to sue the poster",
        "Ignore all copyright complaints",
      ],
      ans: 1,
      why: "Copyright has a defined process with evidence and counter-notice rights. Reviewers should not improvise legal outcomes.",
    },
    {
      q: "Twenty accounts post the same insult at the same target within minutes. What is the best response?",
      opts: [
        "Ban each account one by one without context",
        "Flag the coordinated pattern for specialist review and preserve the evidence",
        "Delete the target's account to stop the harassment",
        "Wait for the posts to go viral",
      ],
      ans: 1,
      why: "Coordination changes the risk and the response. Specialist review can address the network without punishing the target.",
    },
    {
      q: "A sex-education post uses explicit language but is clearly educational, age-restricted and not promotional. Policy permits educational content with a gate. What should you do?",
      opts: [
        "Remove it because it contains explicit language",
        "Apply the educational and age-gate rules, and document the decision",
        "Promote it to all users",
        "Escalate without reading the policy",
      ],
      ans: 1,
      why: "Language alone is not the test. The policy's educational context and age gate determine the right outcome.",
    },
    {
      q: "You personally find a political post offensive, but it does not violate any published rule. What is the correct decision?",
      opts: [
        "Remove it because reviewers must keep the platform clean",
        "Leave it and document that no policy applies",
        "Shadow-ban the author silently",
        "Add a warning label based on your opinion",
      ],
      ans: 1,
      why: "The reviewer applies policy, not personal taste. Documenting the no-violation decision makes the call auditable.",
    },
    {
      q: "An AI triage system marks a post as hate speech with 0.91 confidence. What should the reviewer do?",
      opts: [
        "Remove it immediately because the score is high",
        "Read the post, apply the policy and context rules, and document the final decision",
        "Mark it safe because the model can be wrong",
        "Ask the model to write the removal reason",
      ],
      ans: 1,
      why: "A classifier is a prioritisation signal. The human reviewer still makes and records the policy decision.",
    },
    {
      q: "Look at the severity ladder. Which case belongs at the “escalate immediately” end?",
      opts: [
        "A sarcastic insult between two friends",
        "A credible, specific threat of violence against a named person",
        "A post that criticises a product",
        "A typo in a public advertisement",
      ],
      ans: 1,
      img: "/training/review-capstone.svg",
      alt: "A severity ladder from allow through review to immediate escalation, with example content mapped to each level.",
      why: "Credible, specific threats carry immediate physical risk. Insults and product criticism need the lower rungs of the ladder.",
    },
    {
      q: "Which decision note is strong enough for a second reviewer to defend?",
      opts: [
        "Bad post, removed.",
        "Removed under the harassment policy: the post repeatedly targets a named user with sexual insults. Evidence preserved; no formal appeal on file.",
        "I did not like it.",
        "AI said 0.87, so removed.",
      ],
      ans: 1,
      why: "A defensible note names the policy, the evidence, the action and any appeal or escalation context. Scores and feelings are not evidence.",
    },
  ],
  Translation: [
    {
      q: "An English message says “break a leg” before a performance. What is the best target-language approach?",
      opts: [
        "Translate the words literally so the image survives",
        "Use a natural target-language expression that conveys encouragement before a performance",
        "Replace it with “good luck” and delete the performance context",
        "Leave the English idiom untranslated",
      ],
      ans: 1,
      why: "The goal is the same effect, not the same words. A literal idiom can be grammatically correct and still confuse the reader.",
    },
    {
      q: "A legal disclaimer says the service is provided “as is” without warranties. What is the strongest translation approach?",
      opts: [
        "Summarise it in plain language to make it shorter",
        "Use the established legal equivalent and preserve the full legal effect",
        "Remove it because it is boilerplate",
        "Translate it literally even if the target sentence becomes unclear",
      ],
      ans: 1,
      why: "Legal text prioritises precision and effect. Established equivalents and completeness matter more than brevity or elegance.",
    },
    {
      q: "The same product launch must address a bank partnership and a young consumer audience. What should change between versions?",
      opts: [
        "The facts and the legal terms",
        "The register, examples and tone, while keeping the facts and brand terms consistent",
        "The product name and the price",
        "Nothing; one translation should serve every audience",
      ],
      ans: 1,
      why: "Different audiences need different register and framing. Changing facts or legal terms would create two inconsistent products.",
    },
    {
      q: "A global brand name appears in the source with a trademark symbol. What should the translation do?",
      opts: [
        "Translate the name into a local word",
        "Keep the brand name and symbol as specified in the glossary",
        "Remove the trademark symbol for readability",
        "Lowercase the name to fit the sentence",
      ],
      ans: 1,
      why: "Brand names are proper nouns with legal and marketing constraints. The glossary is the authority.",
    },
    {
      q: "The word “bank” appears in a sentence about a river. The source has no further context. What is the professional approach?",
      opts: [
        "Choose the financial meaning because it is more common",
        "Use the surrounding text to infer the domain and ask if the ambiguity remains material",
        "Translate both meanings in parentheses",
        "Omit the word",
      ],
      ans: 1,
      why: "Context resolves most ambiguity. When it does not, a targeted question is cheaper than a wrong translation.",
    },
    {
      q: "The source gives a distance in miles and the target audience uses kilometres. The brief does not mention conversion. What should you do?",
      opts: [
        "Convert automatically because localisation always means metric",
        "Follow the brief; convert only if it explicitly asks for localisation of units",
        "Keep miles but add a rough conversion in brackets",
        "Change the number without changing the unit",
      ],
      ans: 1,
      why: "Conversion changes a fact. Do it only under an explicit instruction, with a documented rule.",
    },
    {
      q: "A machine-translation draft reads fluently. What is the post-editor's minimum responsibility?",
      opts: [
        "Check only the longest sentences",
        "Verify every segment against the source for meaning, terminology, numbers and formatting",
        "Publish it because fluency implies accuracy",
        "Rewrite it from scratch even if it is correct",
      ],
      ans: 1,
      why: "Fluent output can still be wrong. MTPE requires source-level verification of meaning and every factual detail.",
    },
    {
      q: "The source contains HTML tags around a product name. What should happen to the tags?",
      opts: [
        "Delete them because the target is plain text",
        "Preserve them in the correct positions around the translated content",
        "Move them all to the end",
        "Convert them to Markdown",
      ],
      ans: 1,
      why: "Formatting tags carry structure and sometimes functionality. Preserve them exactly unless the brief says otherwise.",
    },
    {
      q: "Look at the idiom comparison. Why is the literal version marked wrong?",
      opts: [
        "It uses too many words",
        "It preserves the words but loses the meaning and effect in the target language",
        "It is grammatically impossible",
        "It should have been left in English",
      ],
      ans: 1,
      img: "/training/translation-idiom.svg",
      alt: "A literal idiom translation marked wrong beside a natural target-language translation that preserves the meaning.",
      why: "Translation is judged by meaning and effect. A literal rendering can be accurate at word level and useless at message level.",
    },
    {
      q: "A client sends confidential HR text and suggests putting it through a public translation chatbot. What is the correct response?",
      opts: [
        "Use the chatbot because the client suggested it",
        "Remove employee names first and then upload the rest",
        "Do not upload it; ask for an approved tool or translate it inside the approved environment",
        "Upload only the first page",
      ],
      ans: 2,
      why: "Client familiarity with a tool is not authorisation to disclose personal data. Use an approved environment or get explicit clearance.",
    },
  ],
  Research: [
    {
      q: "A company's own website lists one phone number; a business directory lists another. Which is normally stronger?",
      opts: [
        "The directory, because it aggregates many businesses",
        "The company's official website, unless the brief names another primary source",
        "Whichever number looks more local",
        "The older number, because it has existed longer",
      ],
      ans: 1,
      why: "The organisation's own published contact page is generally closer to the source. Directories can be stale or auto-generated.",
    },
    {
      q: "A government registry record is eight months old and the company website shows a newer address. What should you record?",
      opts: [
        "The registry address because government data always wins",
        "The newer address with its source and access date, while noting the registry value if the brief requires corroboration",
        "Both addresses in one field",
        "The address from the first search result",
      ],
      ans: 1,
      why: "Recency and source hierarchy both matter. Record the supported value and preserve the conflict in the evidence trail.",
    },
    {
      q: "A source gives a phone number as 020 123 4567. The brief asks for an international format with a country code. What should you do?",
      opts: [
        "Invent +254 because the business is in Kenya",
        "Use the documented country assumption and apply the brief's format; flag it if the country cannot be established",
        "Submit the number exactly as written and ignore the format",
        "Remove the area code",
      ],
      ans: 1,
      why: "Formatting is allowed; inventing a country is not. A documented assumption or a flag keeps the record honest.",
    },
    {
      q: "A source URL now returns a 404, but the fact was visible when you visited it yesterday. What is the best record?",
      opts: [
        "Keep the dead URL and say nothing",
        "Mark the source as invalid or unavailable, record the access date, and seek an archived or alternative source",
        "Replace it with the website homepage",
        "Delete the fact from the record",
      ],
      ans: 1,
      why: "A reviewer must be able to reproduce the evidence. A homepage does not prove the specific fact; the access note preserves what you saw.",
    },
    {
      q: "A business has three branches. The brief asks for the “main” location but gives no headquarters. What should you do?",
      opts: [
        "Choose the branch closest to you",
        "Record all three and flag that the brief's field is ambiguous",
        "Invent a headquarters address",
        "Skip the task",
      ],
      ans: 1,
      why: "The requested field cannot be resolved from the brief. Recording the evidence and flagging the ambiguity is safer than choosing arbitrarily.",
    },
    {
      q: "An AI assistant gives a confident answer about a company's CEO but cites no source. How should you treat it?",
      opts: [
        "As a verified fact because the answer is specific",
        "As a lead only; open an official source and verify the claim before recording it",
        "As a secondary source you can cite",
        "As proof that no source exists",
      ],
      ans: 1,
      why: "A generated answer is not evidence. The evidence is the page you opened, read and can link to.",
    },
    {
      q: "A task asks for a business owner's home address. The information is not needed to verify the business. What should you do?",
      opts: [
        "Find and record it because the task is about the owner",
        "Do not collect unnecessary private information; record only what the brief requires and escalate the request",
        "Publish it if it appears in a public record",
        "Ask the owner directly on social media",
      ],
      ans: 1,
      why: "Data minimisation applies even when information is technically public. Unnecessary personal data creates risk without serving the task.",
    },
    {
      q: "Two sources give different spellings of a company name. What is the best action?",
      opts: [
        "Merge the two names into one hybrid spelling",
        "Use the official registry or company site, and note the conflict if it affects the record",
        "Choose the shorter spelling",
        "Record both in the same field separated by a slash",
      ],
      ans: 1,
      why: "A source hierarchy resolves naming conflicts. A hybrid invents a third name that no source supports.",
    },
    {
      q: "Look at the source hierarchy. Which source should settle a company's legal registration number?",
      opts: [
        "A recent blog post",
        "The official company registry",
        "A social media profile",
        "A search-result snippet",
      ],
      ans: 1,
      img: "/training/research-sources.svg",
      alt: "A source hierarchy placing official registries and company sites above directories, social posts and search snippets.",
      why: "Legal registration is an official fact. The registry is the primary source; commentary and snippets are secondary at best.",
    },
    {
      q: "After searching official sources, you cannot confirm a business's phone number. What is the correct output?",
      opts: [
        "Use a plausible number from a similar business",
        "Mark the field “Cannot verify” or “Not found” using the brief's status",
        "Leave the field blank without any status",
        "Use the number from a ten-year-old directory",
      ],
      ans: 1,
      why: "An explicit cannot-verify status is information. A guess or a silent blank hides the gap from the client.",
    },
  ],
}
