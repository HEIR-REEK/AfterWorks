/**
 * The expert tier of the built-in assessment bank.
 *
 * Ten questions per category are deliberately multi-step: each one gives a rule, a messy source
 * and a tempting shortcut, then asks for the decision a reviewer could defend. They combine with
 * the ten advanced scenarios in `assessment-bank-extra.ts` to form a twenty-question assessment.
 * Every item is applied; no vocabulary-recall item survives in the served bank. The pass mark is
 * 80%, so a worker cannot pass by recognising a term or choosing the longest option.
 *
 * Keep the answer key here. `assessment-bank.ts` is server-only; the browser receives the public
 * projection with `correctIndex` and `explanation` removed.
 */

import type { RawBankQuestion } from '@/lib/assessment-bank-extra'

export const EXPERT_BANKS: Record<string, RawBankQuestion[]> = {
  'Data Entry': [
    {
      q: 'The brief says the source dates use DD/MM/YYYY and the target must be ISO 8601. The rows are 03/04/2026, 29/03/2026, 12/12/2026 and 01/04/26. Which target set is correct?',
      opts: [
        '2026-04-03, 2026-03-29, 2026-12-12, 2026-04-01',
        '2026-03-04, 2026-03-29, 2026-12-12, 2026-01-04',
        '2026-04-03, 2026-03-29, 2026-12-12, 2026-01-04',
        'Leave every value as written so the source format is preserved',
      ],
      ans: 0,
      why: 'DD/MM/YYYY means 03/04 is 3 April and 01/04/26 is 1 April 2026. Converting to ISO is a format change, not a re-interpretation of the day and month.',
    },
    {
      q: "Two invoice rows share supplier, invoice number, date and total. One description reads “Consulting - Q1”; the other reads “Consulting - Q1 - revised”. The brief says the duplicate key is supplier + invoice number + date + amount, and that a different line description is not proof of a duplicate. What is the correct action?",
      opts: [
        'Delete the row marked “revised” because it is clearly the later duplicate',
        'Merge the two descriptions into one row and keep one total',
        'Keep both rows and flag the possible duplicate for client confirmation',
        'Change the amount on one row so the records no longer match',
      ],
      ans: 2,
      why: 'The stated key matches, but the brief also says a description difference does not settle the question. The safe output preserves both rows and asks; deleting or merging invents a decision the source did not support.',
    },
    {
      q: 'The target schema distinguishes blank (not supplied), 0 (supplied as zero) and N/A (the field does not apply). A source row shows “N/A” in delivery fee. What should the target contain?',
      opts: [
        'A blank cell, because no delivery fee was supplied',
        'The number 0, because no delivery was charged',
        'The not-applicable marker defined by the brief, preserving the distinction',
        'Delete the whole row because a required field is missing',
      ],
      ans: 2,
      why: 'Blank, zero and not-applicable are three different facts. Collapsing N/A into blank or zero destroys the meaning the schema was designed to preserve.',
    },
    {
      q: 'A 50-row reconciliation balances perfectly, but row 17 records 1,250 as 125 and row 42 records 125 as 1,250. The source PDF shows the original amounts. What is the professional response?',
      opts: [
        'Accept the file because the total is correct',
        'Correct both rows against the source, then re-run the row-level and total checks',
        'Correct only the larger row so the total stays the same',
        'Reject the whole batch without identifying the rows',
      ],
      ans: 1,
      why: 'A matching total can hide two offsetting errors. The row-level facts still have to be right, and the correction must be re-verified after it is made.',
    },
    {
      q: 'An address reads “Jamia Mall, 3rd Floor, Ngong Road, P.O. Box 12345-00100 Nairobi”. The target has street, building, floor, postal_address, postal_code and city columns, and the brief forbids inferring a missing component. Which mapping is safest?',
      opts: [
        'street = Ngong Road; building = Jamia Mall; floor = 3rd Floor; postal_address = P.O. Box 12345-00100; postal_code = 00100; city = Nairobi',
        'Put the entire line in street and leave every other address column blank',
        'Use 00100 as the postal code, infer Nairobi from it, and omit the P.O. Box',
        'street = Jamia Mall; building = Ngong Road; floor = 3rd Floor; postal_code = 12345',
      ],
      ans: 0,
      why: 'Every component in option A is present in the line. The postal code is the 00100 suffix of the P.O. Box, not a guess. Splitting building and street the other way round, or discarding the box, loses source information.',
    },
    {
      "q": "An invoice dated 2026-03-14 is in USD. The brief says to convert with the central-bank rate for the document date, store the rate and its date beside the converted amount, and never use the payment-date rate. Finance settled the invoice on 2026-04-02. Which conversion is correct?",
      "opts": [
        "Use the 2026-04-02 rate because that is when the money moved",
        "Use the 2026-03-14 rate and store that rate and date with the converted amount",
        "Average the rates for the two dates so neither date is favoured",
        "Leave the amount in USD and note only the invoice date"
      ],
      "ans": 1,
      "why": "The brief defines the valuation date as the document date and requires an audit trail for the rate. Using the settlement date changes the recorded fact; averaging invents a rate that never existed."
    },
    {
      "q": "A CSV contains the phone number 0712 345 678. The target schema stores phone numbers as text because the leading zero is meaningful. The last import silently produced 712345678. What control prevents the loss?",
      "opts": [
        "Set the target column to text before import, import the exact digits, then verify the stored value still starts with zero",
        "Import as a number and apply a display format that adds one zero",
        "Drop the leading zero because the country code identifies the number",
        "Replace the whole value with +254 712 345 678 without checking the brief"
      ],
      "ans": 0,
      "why": "A display format is cosmetic; the stored value has already lost the zero. Text must be set before import and verified afterwards. Adding or replacing digits changes the source fact."
    },
    {
      "q": "Two supplier rows carry the same national ID. One reads “J. Mwangi” with phone A; the other reads “John Mwangi” with phone B. The brief makes the national ID the unique person key, requires conflicting source values to be preserved for review, and forbids silent overwrites. What is the defensible record?",
      "opts": [
        "Keep the newest row only and normalise the name to John Mwangi",
        "Keep two separate people because the names and phones differ",
        "Keep one master record keyed by the ID, retain both source variants, and flag the name and phone conflict for review",
        "Delete both rows until the supplier confirms which one is real"
      ],
      "ans": 2,
      "why": "The stated key says this is one person, but the conflicting facts are not yours to resolve silently. A single keyed record plus preserved variants and a conflict flag keeps both the rule and the evidence."
    },
    {
      "q": "A printed receipt shows a total of 4,580. A handwritten 4,850 is written beside it and initialled by the cashier. The brief says an initialled manuscript correction supersedes the printed value and the original must be noted. What do you enter?",
      "opts": [
        "4,580, because the printed value is always the document of record",
        "4,850, with a note recording the superseded printed 4,580",
        "4,715, the midpoint of the two values",
        "Both values in the total field, separated by a slash"
      ],
      "ans": 1,
      "why": "The brief gives the initialled correction priority and asks for the original to be retained. The other options either ignore the stated rule or invent a value that appears nowhere on the document."
    },
    {
      "q": "The capstone row template has `Tax` and `Total`. For DOC-014 the receipt shows a dash where a separate tax amount would be, while the printed total already includes VAT. The brief reserves blank for “not supplied” and 0 for “supplied as zero”. Which entry preserves both facts?",
      "opts": [
        "Tax blank; Total 4,850",
        "Tax 0; Total 4,850",
        "Tax N/A; Total 4,850; note that VAT is included in the printed total",
        "Tax 600; Total 4,250"
      ],
      "ans": 2,
      "why": "A dash says the tax was not broken out, not that it was zero or missing. The not-applicable marker plus a note keeps the inclusive total and prevents a later analyst from adding VAT twice.",
      "img": "/training/data-entry-capstone.svg",
      "alt": "A capstone row template for DOC-014 with date, merchant, total and a dash for tax, beside an exception queue and a receipt."
    },
  ],
  Transcription: [
    {
      q: 'A speaker says: “The fee is twenty-five thousand — no, sorry, twenty-five hundred.” The brief requires strict verbatim and says audible self-corrections must remain. What should the transcript contain?',
      opts: [
        'Only “twenty-five hundred”, because that is the final decision',
        '“The fee is twenty-five thousand — no, sorry, twenty-five hundred.”',
        'A single tagged value: “[correction] 2,500”',
        'Both values in a footnote, with the sentence itself cleaned up',
      ],
      ans: 1,
      why: 'Strict verbatim preserves what was said, including the correction. Silently replacing the first figure changes the record; a footnote does not replace the spoken line.',
    },
    {
      q: 'A song plays under a speaker. The brief says to transcribe speech, not lyrics, and to tag non-speech audio only when it prevents you hearing the speech. The speaker is fully audible. What is correct?',
      opts: [
        'Transcribe the lyrics as well, because they are part of the audio',
        'Insert [music] across the speaker’s lines',
        'Transcribe the speech and do not transcribe the lyrics; follow the style guide if a music note is required',
        'Stop transcribing until the music ends',
      ],
      ans: 2,
      why: 'The brief draws the boundary: speech is the deliverable, lyrics are not, and a tag is for obscuring audio. The speaker remained clear, so no obstruction tag is justified.',
    },
    {
      q: 'A speaker reads a mobile-money confirmation code. A cough covers one character; every other character is clear. The brief says codes must be exact and must never be guessed. What should you do?',
      opts: [
        'Reconstruct the most likely character from the surrounding pattern',
        'Insert an approved unclear marker inside the code and flag the timestamp for client confirmation',
        'Omit the code from the transcript entirely',
        'Write the code without the missing character and mark the row complete',
      ],
      ans: 1,
      why: 'A code is an exact identifier. The honest output shows the uncertainty and asks for confirmation; a plausible guess or a silently shortened code is a false record.',
    },
    {
      q: 'The style sheet says to use numerals, preserve spoken self-corrections and never convert units. The speaker says: “It’s 1.5 — sorry, 1.15 million shillings.” Which line follows the brief?',
      opts: [
        'It’s 1.15 million shillings.',
        'It’s 1.5 — sorry, 1.15 million shillings.',
        'It’s [correction] 1.15M shillings.',
        'It’s 1,150,000 shillings.',
      ],
      ans: 1,
      why: 'This preserves both the correction and the spoken unit. Converting to 1,150,000 changes the form, and keeping only the final value removes the audible correction the brief protects.',
    },
    {
      q: 'After 30 minutes, the recorder’s embedded clock is four seconds behind the approved audio player. The brief requires timestamps taken from the player and checked against the audio. What is the strongest response?',
      opts: [
        'Add four seconds to every timestamp after the 30-minute mark',
        'Re-derive the timestamps from the approved player, re-check alignment, and document the drift',
        'Remove timestamps after 30 minutes so the mismatch cannot be seen',
        'Keep using the recorder clock because it is embedded in the file',
      ],
      ans: 1,
      why: 'A mechanical offset can drift and vary, so a blanket adjustment is not proof. Re-deriving from the required source and documenting the issue is the defensible workflow.',
    },
    {
      "q": "A recorder starts at 00:12:40 and runs continuously. The player shows 00:03:10 for a sentence you are timing. The brief requires timestamps on the recorder clock, not the player clock. What timestamp belongs in the transcript?",
      "opts": [
        "00:03:10",
        "00:09:30",
        "00:15:50",
        "00:12:40"
      ],
      "ans": 2,
      "why": "The recorder was already 12 minutes 40 seconds into its run. Adding the player position gives 15 minutes 50 seconds; copying the player clock would misplace the line by the length of the earlier recording."
    },
    {
      "q": "Two participants are both introduced as “Alex” — the client and the guest. The brief requires unique speaker labels and a speaker map, and it forbids voice matching. What should the transcript do?",
      "opts": [
        "Merge both participants under the label Alex",
        "Assign distinct labels such as Alex 1 and Alex 2, and record their roles in the speaker map",
        "Infer which Alex is speaking from the topic of each turn",
        "Use [unclear speaker] for every turn by either Alex"
      ],
      "ans": 1,
      "why": "A shared name is not a shared speaker. Distinct labels plus a role map preserve every turn without guessing identity; merging or guessing would corrupt the speaker-level evidence."
    },
    {
      "q": "A speaker reads a mobile-money code aloud. The brief says to mask the digits while keeping the sentence and the speaker turn intact. Which transcript line follows it?",
      "opts": [
        "Delete the whole sentence so the code cannot be recovered",
        "“Send it to [mobile-money code redacted].”",
        "“Send it to [redacted]” and delete the surrounding words as well",
        "Replace the entire turn with [PII]"
      ],
      "ans": 1,
      "why": "The instruction is to mask the sensitive value, not to erase the conversation. Keeping the sentence structure and placing a precise tag around the digits preserves meaning and protects the data."
    },
    {
      "q": "A speaker switches to Swahili for one clause. The brief says to keep the source words, add `[translation: ...]` only when the approved glossary supplies the meaning, and never paraphrase. The glossary contains the clause. Which line follows the brief?",
      "opts": [
        "Translate the clause into English and drop the Swahili",
        "Keep the Swahili clause, then add [translation: the approved glossary wording]",
        "Keep the Swahili and write your own summary of it in English",
        "Tag [foreign language] and omit the clause"
      ],
      "ans": 1,
      "why": "The source words are evidence and the approved glossary is the only permitted translation. Omitting the clause or paraphrasing it removes or changes what the speaker actually said."
    },
    {
      "q": "At 04:18 in the capstone call the guest's name is not clear. The brief says never choose the most plausible spelling. What should the transcript contain?",
      "opts": [
        "The spelling that sounds most likely, marked as final",
        "[inaudible 00:04:18] or a query to the project lead, with the answer recorded when it arrives",
        "No guest name anywhere in the transcript",
        "A guessed name followed by [name?]"
      ],
      "ans": 1,
      "why": "An unclear name is a known gap, not an invitation to guess. A timestamped tag or a targeted query keeps the gap visible and gives a reviewer a way to close it.",
      "img": "/training/transcription-capstone.svg",
      "alt": "A capstone speaker map for a three-speaker call with a highlighted instruction that an unclear guest name at 04:18 must be tagged or queried, never guessed."
    },
  ],
  'Image Labeling': [
    {
      q: 'The label definition says an object may be labelled only when at least 30% of it is visible. A vehicle is 28% visible but unmistakably a vehicle. What should you do?',
      opts: [
        'Label it because the class is obvious',
        'Do not label it; the visibility threshold is part of the definition',
        'Label it with a lower confidence score instead of following the threshold',
        'Crop the image so more of the vehicle appears',
      ],
      ans: 1,
      why: 'Consistency comes from applying the written boundary, not from confidence in the class. A reviewer must be able to reproduce the same decision on every image.',
    },
    {
      q: 'A box must cover the object but exclude its shadow, reflections and nearby background. The object’s visible pixels touch a strong shadow on the left. Which box is correct?',
      opts: [
        'A tight box around the visible object, excluding the shadow',
        'A box that includes the shadow because it touches the object',
        'A box around the whole image tile',
        'A box around the object plus a fixed 20-pixel margin on every side',
      ],
      ans: 0,
      why: 'The label is the object, not the light it casts. A tight box around visible object pixels keeps the training signal clean and consistent with the definition.',
    },
    {
      q: 'An image contains a person, a bicycle and a delivery crate. The label set is person and bicycle only. What is the correct output?',
      opts: [
        'Add a new crate class because the object is obvious',
        'Label person and bicycle; ignore the crate',
        'Label the crate as a bicycle because it is attached to one',
        'Skip the image because it contains an unlisted object',
      ],
      ans: 1,
      why: 'Annotators apply the supplied label set, they do not extend it. An unlisted object is not a reason to invent a class or discard otherwise usable images.',
    },
    {
      q: 'The same photograph appears twice in a batch under different filenames. The brief says to label unique images and report duplicates so the batch count is not inflated. What is the correct action?',
      opts: [
        'Label both copies normally and do not mention the duplication',
        'Label one copy, flag the duplicate pair, and let the batch owner decide the count',
        'Delete one file without telling anyone',
        'Label both but assign the second copy a different class',
      ],
      ans: 1,
      why: 'The worker can identify the duplicate but should not silently change the batch. Labelling once and flagging preserves the evidence and prevents duplicate pay without hiding the issue.',
    },
    {
      q: 'A person is holding a phone. Both person and phone are in the label set, and their boxes overlap. What is the strongest annotation?',
      opts: [
        'One combined box labelled person because the phone is being held',
        'Separate boxes for person and phone, each covering its own object as tightly as the definition allows',
        'Only the phone, because it is the smaller object',
        'Only the person, because the phone is occluded by the hand',
      ],
      ans: 1,
      why: 'Overlap is expected when objects overlap. Each class still gets its own box; merging them teaches the model that the phone is part of the person.',
    },
    {
      "q": "The project's visibility minimum is 30% of the object's true extent. A pedestrian is 28% visible behind a parked bus. What is the correct action?",
      "opts": [
        "Draw a full box by estimating the hidden 72% behind the bus",
        "Draw a box around the visible 28% and label it pedestrian",
        "Do not label the object and note that it falls below the visibility threshold",
        "Label the visible region as part of the bus"
      ],
      "ans": 2,
      "why": "The threshold is a project rule, not a suggestion. A box below it creates training data the project has said it does not want; estimating the hidden extent also invents pixels."
    },
    {
      "q": "A hand holds a phone. Both are annotation classes, both are larger than the minimum size, and the phone overlaps the hand. What is correct?",
      "opts": [
        "Label the hand only, because it occludes the phone",
        "Label the phone only, because it is the smaller object",
        "Draw one merged box around the hand and phone",
        "Label both independently, each box following that object's visible extent"
      ],
      "ans": 3,
      "why": "Overlap does not erase a class. Each object keeps its own box and label; merging them teaches the model a combined object that the taxonomy does not contain."
    },
    {
      "q": "Twelve people are visible. The minimum height is 20 px: seven people meet it and five are below it. The taxonomy has no group class. What is correct?",
      "opts": [
        "Draw twelve boxes so no person is missed",
        "Draw seven boxes and send the five below-minimum cases to the unsure or exception queue if the brief requires it",
        "Draw one large group box around all twelve",
        "Draw five boxes for the people below the threshold"
      ],
      "ans": 1,
      "why": "The minimum size and the absence of a group class decide the output. Labelling below-minimum people or inventing a group class breaks the taxonomy; the exception queue preserves the uncertainty."
    },
    {
      "q": "A car is half hidden by a van. The brief says boxes cover visible pixels only and full-extent estimation is forbidden. Where does the car's box end?",
      "opts": [
        "At the image edge, with the hidden half estimated",
        "At the visible boundary where the van begins",
        "Beyond the van, so the whole car is enclosed",
        "The car is skipped because it is occluded"
      ],
      "ans": 1,
      "why": "Visible pixels only means the box stops where the evidence stops. Estimating or enclosing the van would record geometry the image does not show.",
      "img": "/training/labeling-capstone.svg",
      "alt": "A labeling capstone street scene showing a tight box that stops at the van, a loose box that wrongly includes road and shadow, and a taxonomy panel."
    },
    {
      "q": "A tree trunk splits a visible bicycle into two separate regions. The task uses polygons and the brief says to trace visible pixels. What is correct?",
      "opts": [
        "One polygon that crosses the trunk so both regions stay connected",
        "Two polygons around the visible regions, with a note linking them if the brief requires it",
        "One bounding box that includes the trunk and both regions",
        "Skip the bicycle because it is not a single continuous shape"
      ],
      "ans": 1,
      "why": "A polygon follows the visible outline; it cannot claim the trunk pixels between the regions. Separate shapes keep the mask honest, while the note preserves the fact that they are one object."
    },
  ],
  'Content Review': [
    {
      q: 'A post criticises a government policy in harsh language but contains no threat, no incitement and no attack on a protected group. The policy allows strong political criticism. What is the correct decision?',
      opts: [
        'Remove it because the language is rude',
        'Leave it up; it does not meet a removal category',
        'Remove it only if it has more than 100 comments',
        'Escalate it as a credible threat because it criticises the government',
      ],
      ans: 1,
      why: 'Disagreement and harsh tone are not, by themselves, policy violations. Removing lawful criticism because a reviewer dislikes it is inconsistent enforcement.',
    },
    {
      q: 'A user quotes a racial slur while condemning racism and asking others not to use it. The policy permits quoted slurs in reporting, education and condemnation, but not when used to attack. What should you do?',
      opts: [
        'Remove it automatically because the slur appears',
        'Leave it with the context intact; it is condemnation, not an attack',
        'Remove the whole thread and suspend the user',
        'Edit the post to delete the word without telling the author',
      ],
      ans: 1,
      why: 'The policy turns on use, not on the bare string. The surrounding sentence is the evidence that this is a condemnation, so context must be read before enforcement.',
    },
    {
      q: 'A post claims a common home remedy cures a chronic disease. It is false and potentially harmful, but it does not call for imminent violence or describe an immediate emergency. Which policy response fits?',
      opts: [
        'Treat it as an emergency and remove it without review',
        'Apply the health-misinformation label and the normal review path',
        'Leave it alone because health claims are always opinion',
        'Ban the author permanently for a first post',
      ],
      ans: 1,
      why: 'The policy distinguishes false health claims from imminent-harm emergencies. The correct path is the misinformation process, not the emergency process and not no action at all.',
    },
    {
      q: 'Twenty accounts post nearly identical comments praising the same product at the same minute. Each comment, read alone, is harmless. What is the strongest review decision?',
      opts: [
        'Ignore them because no single comment breaks a rule',
        'Flag the coordinated pattern for spam/network review rather than judging only one comment',
        'Delete one comment as an example and leave the rest',
        'Remove the product name from every comment',
      ],
      ans: 1,
      why: 'Coordinated inauthentic behaviour is a network-level signal. Reviewing each post in isolation hides the pattern and produces inconsistent enforcement.',
    },
    {
      q: 'A reviewer personally finds a post offensive, but it does not meet any written policy category. The queue is busy and the reviewer wants to remove it “to be safe”. What is the correct action?',
      opts: [
        'Remove it; personal discomfort is enough',
        'Leave it up and record that no policy category applied',
        'Hide it for 24 hours without a reason',
        'Ask another reviewer to remove it instead',
      ],
      ans: 1,
      why: 'Policy enforcement must be based on the written categories, not a reviewer’s taste. Documenting the decision also makes the outcome auditable and consistent.',
    },
    {
      "q": "A news article quotes a racial slur inside a sentence condemning a racist attack. Policy allows quoted slurs when the article clearly condemns the language and does not target anyone. What is the correct decision?",
      "opts": [
        "Remove the article because the slur appears in it",
        "Allow it with a context note, and do not amplify the slur in the title or thumbnail",
        "Remove only the slur and leave the rest of the sentence",
        "Suspend the author for using a slur"
      ],
      "ans": 1,
      "why": "The policy turns on condemnation and targeting, not on the presence of the word. Allowing with context and refusing amplification applies that rule without rewarding or spreading the slur."
    },
    {
      "q": "Twenty accounts post the same shortened link and identical text within ten minutes, each from a different profile. What is the strongest enforcement response?",
      "opts": [
        "Delete the twenty posts individually and close the cases",
        "Permanently suspend all twenty accounts without further review",
        "Treat it as a coordinated network: preserve evidence, escalate for network review, and remove the content under the spam policy",
        "Ignore it because each account posted only once"
      ],
      "ans": 2,
      "why": "The pattern is the violation, not twenty unrelated posts. Preserving evidence and escalating the network stops the source; deleting each post in isolation leaves the campaign free to continue."
    },
    {
      "q": "A post labelled “satire” tells readers to drink bleach to cure an infection. The label is small and below the fold. Health policy removes actionable harmful claims regardless of claimed intent. What is correct?",
      "opts": [
        "Allow it because satire is exempt from health policy",
        "Remove or downrank it under the health policy and note that the label does not neutralise the instruction",
        "Edit the post to add a warning while leaving the claim up",
        "Refer it to law enforcement and take no platform action"
      ],
      "ans": 1,
      "why": "A label does not turn a harmful instruction into safe speech, especially when it is easy to miss. The policy is written for the actionable claim, so the content comes down and the reasoning is recorded."
    },
    {
      "q": "A bystander video shows a fatal crash. It is newsworthy, no victim's face is identifiable, and policy permits graphic newsworthy content only with a warning and an age gate. What is correct?",
      "opts": [
        "Remove it because it shows death",
        "Allow it with a warning and age gate, and document why it has news value",
        "Allow it with no restriction because it is newsworthy",
        "Remove the audio but keep the video unrestricted"
      ],
      "ans": 1,
      "why": "The policy creates a conditional allowance, not a blanket ban or a blanket pass. Applying the warning and age gate while recording the news-value decision is the defensible middle."
    },
    {
      "q": "The capstone says a note must be one a second reviewer can defend. Which note meets that standard for a removed post?",
      "opts": [
        "“I did not like it.”",
        "“Violence policy: shown beating with visible injury; context = unlabeled street fight; evidence = frames 00:12–00:18. Removed; no newsworthy framing.”",
        "“Spam.”",
        "“Escalated to supervisor.”"
      ],
      "ans": 1,
      "why": "A defensible note names the policy, the context and the evidence. Personal dislike, a bare label or an escalation with no reason cannot be reviewed or appealed consistently.",
      "img": "/training/review-capstone.svg",
      "alt": "A content-review capstone board with allow, review, remove and escalate stations, each requiring a policy category, context and evidence note."
    },
  ],
  Translation: [
    {
      q: 'A safety briefing says “bite the bullet and report the near miss”. A literal translation would confuse the audience. The glossary supplies a meaning-based equivalent, and the brief says idioms should carry the intended meaning. What should you use?',
      opts: [
        'A literal translation of “bite the bullet”',
        'The glossary’s meaning-based equivalent, with the warning intact',
        'The English idiom unchanged in the target text',
        'Delete the sentence because idioms cannot be translated',
      ],
      ans: 1,
      why: 'The purpose is to transfer the warning, not the English image. The approved equivalent keeps the meaning and the glossary keeps terminology consistent across the batch.',
    },
    {
      q: 'The source says “the bank approved the loan”. The target language has one word that can mean a river bank or a financial institution. What is the correct translation decision?',
      opts: [
        'Choose the river-bank sense because it is the most common dictionary entry',
        'Choose the financial sense, because the loan context disambiguates it',
        'Leave the word untranslated',
        'Ask the reader to infer the meaning from the sentence',
      ],
      ans: 1,
      why: 'The surrounding words “approved the loan” select the financial sense. A dictionary’s first entry is not the context-sensitive meaning.',
    },
    {
      q: 'A legal phrase has no exact equivalent in the target language. The client glossary provides an approved term and a required footnote. What is the strongest translation?',
      opts: [
        'Invent a literal phrase and omit the footnote',
        'Use the glossary term and the required footnote, preserving the legal effect',
        'Replace the phrase with a simpler word that changes the legal effect',
        'Leave the phrase in English with no note',
      ],
      ans: 1,
      why: 'Legal meaning must survive. The approved term plus the required note is the controlled solution; a literal invention or a silent simplification changes the obligation.',
    },
    {
      q: 'The source shows “£1,200” and the brief says to preserve the amount and currency while localising the date and number format. Which target rendering is correct?',
      opts: [
        'Convert the amount to the local currency using today’s rate',
        'Keep GBP 1,200 (or the approved currency notation) and localise the surrounding format only',
        'Drop the currency symbol and write 1,200',
        'Change the amount to the local currency and omit the original',
      ],
      ans: 1,
      why: 'A translation is not a currency conversion unless the brief asks for one. Converting introduces a rate and changes a fact the client asked to preserve.',
    },
    {
      q: 'A clinical term is neutral in the source but the obvious target word is vulgar in one region. The brief supplies an approved clinical term. What should you do?',
      opts: [
        'Use the vulgar word because it is the most direct equivalent',
        'Use the approved clinical term; flag any regional ambiguity for the client',
        'Replace the term with a euphemism the client did not approve',
        'Omit the term and shorten the sentence',
      ],
      ans: 1,
      why: 'The approved term keeps the register and the clinical meaning. Flagging a genuine regional issue is honest; substituting slang or a euphemism makes a clinical document inconsistent.',
    },
    {
      "q": "The source says: “The bank approved the loan after reviewing the riverbank survey.” The client glossary maps the financial institution to benki and the riverbank to ukingo wa mto. How should the sentence be translated?",
      "opts": [
        "Use benki for both occurrences",
        "Use ukingo wa mto for both occurrences",
        "Use benki for the institution and ukingo wa mto for the riverbank, following the co-text",
        "Leave both occurrences in English to avoid choosing"
      ],
      "ans": 2,
      "why": "One spelling does not mean one meaning. The glossary resolves the ambiguity, and the surrounding words identify which sense each occurrence carries."
    },
    {
      "q": "A contract uses the term force majeure. The approved glossary supplies a Swahili legal equivalent, and the brief requires a translator footnote only when no approved equivalent exists. What is correct?",
      "opts": [
        "Paraphrase it as bad weather so lay readers understand",
        "Use the approved glossary equivalent, with no footnote",
        "Keep force majeure and add a translator footnote",
        "Omit the clause because it has no everyday equivalent"
      ],
      "ans": 1,
      "why": "The glossary term is the client's required wording, and the footnote condition is not met. Paraphrasing changes the legal effect; leaving the Latin term ignores the glossary."
    },
    {
      "q": "A Kenyan price list in KES is translated for a Ugandan audience. The brief says to preserve currency and amount and treats currency conversion as out of scope. What should the target show?",
      "opts": [
        "The converted UGX amount at today's rate",
        "KES 4,850 unchanged, with only target-locale number formatting applied",
        "The amount converted to USD for comparison",
        "The number without any currency symbol"
      ],
      "ans": 1,
      "why": "Preserving currency is a factual instruction; converting it would make the target say something the source did not. Formatting the number for the locale is separate from changing its currency."
    },
    {
      "q": "The source is declared en-GB and reads 12/05/2026. The brief says to resolve dates from the declared source locale and never guess from the digits. What date does the source mean?",
      "opts": [
        "5 December 2026",
        "12 May 2026",
        "5 December 2026 in US format",
        "It is ambiguous, so ask even though the locale is declared"
      ],
      "ans": 1,
      "why": "In en-GB the day comes first, so 12/05 is 12 May. Asking is unnecessary once the source locale is declared; assuming US order would silently move the date by seven months."
    },
    {
      "q": "The capstone produces a formal partner version and a social version. Which pair of changes keeps both versions factually identical?",
      "opts": [
        "Change the price and drop the disclaimer in the social version",
        "Change the register and transcreate the idiom in the social version while keeping the price, date, product name and disclaimer",
        "Replace the legal terms with simpler words in the social version",
        "Use different date formats and omit the terms in the social version"
      ],
      "ans": 1,
      "why": "Register and idiom can move with the audience; facts and legal effect cannot. Price, date, product and disclaimer must survive both versions unchanged.",
      "img": "/training/translation-capstone.svg",
      "alt": "A translation capstone comparing a formal partner version and a conversational social version of one launch message, with a checklist for facts, dates, tags, brand terms and disclaimers."
    },
  ],
  Research: [
    {
      q: 'A company registry updated this year names a new CEO. A news article from three years ago names the previous CEO. The brief asks for the current CEO and allows official registries. What should you record?',
      opts: [
        'The news article’s name, because news is easier to read',
        'The registry’s current name, with a note that older coverage conflicts',
        'Both names in the CEO field without explanation',
        'Leave the field blank because the sources disagree',
      ],
      ans: 1,
      why: 'Source authority and recency both matter here: the official registry is the stronger source for a current officer. Recording the conflict makes the decision auditable.',
    },
    {
      q: 'A company website says “serving clients since 2019”, while the official company register gives an incorporation date of 2018. The brief asks for the legal incorporation date. Which value and note are correct?',
      opts: [
        '2019, because the website is the company’s own story',
        '2018 from the register, with the website claim noted as marketing copy',
        '2019, averaged with 2018',
        'Leave the date blank because two dates exist',
      ],
      ans: 1,
      why: 'The field asks for a legal fact, not brand history. The register owns incorporation; the website phrase is not necessarily a legal date and should not override it.',
    },
    {
      q: 'Two different companies in two towns share the same trading name. The brief asks for the one at a specific address. What is the strongest way to disambiguate?',
      opts: [
        'Choose the first search result',
        'Match the registered address or registration number, and record the identifier used',
        'Merge both companies’ details into one row',
        'Choose the company with the larger website',
      ],
      ans: 1,
      why: 'A name is not a unique key. Address or registration number proves which entity the brief means, and recording the identifier lets a reviewer reproduce the choice.',
    },
    {
      q: 'A search snippet shows a phone number, but the live page has since changed and the old number no longer appears. The page is still reachable. What should you record?',
      opts: [
        'The snippet’s number, because it appeared in search results',
        'The current live page’s number, with the date checked',
        'Both numbers in one cell with no explanation',
        'The old number and a note that the page changed',
      ],
      ans: 1,
      why: 'A snippet is a stale cache, not the current source. Verify the live page, record what it now says, and timestamp the check so the finding can be audited.',
    },
    {
      q: 'A product page shows one price including VAT and another excluding VAT. The brief asks for the shelf price a customer sees. What is correct?',
      opts: [
        'Record the ex-VAT price because it is the smaller number',
        'Record the displayed customer price, and note the tax basis if the page distinguishes it',
        'Average the two prices',
        'Convert both to another currency and record that',
      ],
      ans: 1,
      why: 'The brief defines the field as the customer-facing shelf price. The tax basis is context a reviewer needs; averaging or converting changes the fact being collected.',
    },
    {
      "q": "A company's current leadership page names one CEO, while a three-year-old news article names someone else. The brief requires the current officer with the exact source URL and access date. What do you record?",
      "opts": [
        "The old article, because independent news outranks the company",
        "The current leadership page with its URL and access date, plus a note about the older article",
        "Both names in the CEO field",
        "No CEO, because the sources conflict"
      ],
      "ans": 1,
      "why": "The field asks for the current officer and the brief supplies a source rule. The current official page meets both; the older article is a discrepancy to note, not the current fact."
    },
    {
      "q": "Marketing copy says “serving clients since 2019”. The official registry shows incorporation on 2021-06-02. The field is incorporation_date, defined as the registry date. What do you enter?",
      "opts": [
        "2019-01-01, because that is when the business says it started",
        "2021-06-02 with the registry source, and keep the marketing claim as a note only",
        "Leave the field blank because the two sources conflict",
        "2020, midway between the two claims"
      ],
      "ans": 1,
      "why": "The field definition names the registry as the authority. The marketing claim is evidence about the company's story, not the incorporation date, so it belongs in a note rather than in the date field."
    },
    {
      "q": "A shelf label shows KES 1,160 and “VAT inclusive”. The brief asks for the customer-facing shelf price and its tax status; it does not ask you to calculate net. What do you record?",
      "opts": [
        "1,000, with VAT",
        "1,160 with tax_status = inclusive and no subtraction",
        "1,160 with tax_status blank",
        "1,000 net and 160 VAT in two separate fields"
      ],
      "ans": 1,
      "why": "The field is the price a customer sees, and the label states its tax basis. Subtracting VAT changes the requested fact and turns an observed price into a derived one."
    },
    {
      "q": "Three sources disagree. The registry lists Address C, updated eight months ago; the company site lists Address A; a map listing and the site agree on Address B, and the capstone's verified record places the office at Address B. The brief requires the strongest current evidence with conflicts noted. What do you record?",
      "opts": [
        "Address C, because a registry is always the official source",
        "Address A, because the company website always wins",
        "Address B, citing the agreeing current sources, and note the conflicting registry and site entries",
        "All three addresses in the address field"
      ],
      "ans": 2,
      "why": "Recency and independent agreement matter more than the label “official”. Address B is supported by two current sources and the capstone's verified record; the conflict still has to be visible to the reviewer.",
      "img": "/training/research-capstone.svg",
      "alt": "A research capstone showing three conflicting company sources and a verified record that combines the legal name, address, phone and status with evidence for each."
    },
    {
      "q": "A company's contact page lists +254 20 123 4567; a business directory lists +254 20 765 4321. The brief says to use the official company source and record the exact page and access date. What do you do?",
      "opts": [
        "Use the directory number because directories clean up stale listings",
        "Use the contact-page number with its exact URL and access date, and note the directory conflict if the brief requires it",
        "Put both numbers in the phone field",
        "Use neither number because the sources disagree"
      ],
      "ans": 1,
      "why": "The brief names the official company source and asks for traceability. That fixes the primary record; the directory value is a discrepancy, not an equal candidate or a reason to leave the field empty."
    },
  ],
}
