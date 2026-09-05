'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { assessmentPassMark, type AssessmentQuestion, type JobCategory } from '@/lib/afterworks-data'
import { CheckCircle2, Circle, AlertCircle } from 'lucide-react'

// Generate 15 distinct questions based on category
function generateQuestions(category: JobCategory) {
  const banks: Record<string, {q: string, opts: string[], ans: number}[]> = {
    'Transcription': [
      { q: 'How should you handle overlapping speech between two speakers?', opts: ['Only transcribe the louder speaker.', 'Use [crosstalk] tags or separate speaker labels with timestamps.', 'Ignore the overlapping section.', 'Combine both speakers into one sentence.'], ans: 1 },
      { q: 'If a speaker uses filler words (e.g., "um", "uh"), what is standard practice for strict verbatim?', opts: ['Always include them exactly as spoken.', 'Always delete them.', 'Replace them with periods.', 'Change them to formal words.'], ans: 0 },
      { q: 'When you encounter an unfamiliar medical term, you should:', opts: ['Guess the spelling.', 'Use the provided glossary or search online to verify spelling.', 'Skip the word.', 'Use [unclear] immediately.'], ans: 1 },
      { q: 'How do you format a change in speakers?', opts: ['Start a new line with the speaker label.', 'Just continue on the same line.', 'Use a comma.', 'Add [New Speaker].'], ans: 0 },
      { q: 'If the audio cuts out completely for a few seconds, you should:', opts: ['Make up dialogue.', 'Use an [audio cut] or [silence] tag with a timestamp.', 'Stop transcribing.', 'Skip to the end.'], ans: 1 },
      { q: 'When a speaker stutters (e.g., "I- I- I went"), how is it usually handled in strict verbatim?', opts: ['Remove the stutters.', 'Include all stutters exactly as spoken.', 'Write it once.', 'Put it in brackets.'], ans: 1 },
      { q: 'What is the correct way to transcribe numbers in general non-technical transcription?', opts: ['Always spell them out (e.g., "one").', 'Use numerals for 10 and above, spell out one through nine.', 'Always use numerals (e.g., "1").', 'It doesn\'t matter.'], ans: 1 },
      { q: 'If background noise obscures a word, what is the best tag to use?', opts: ['[inaudible]', '[noise]', '[unknown]', '[blank]'], ans: 0 },
      { q: 'How should you transcribe a clear but grammatical error made by the speaker (e.g., "He don\'t know")?', opts: ['Fix the grammar to "He doesn\'t know".', 'Transcribe exactly as spoken: "He don\'t know".', 'Add [sic] after it.', 'Delete the sentence.'], ans: 1 },
      { q: 'When transcribing a podcast, how often should timestamps typically be added if not specified?', opts: ['Every 30 seconds.', 'Every 2 to 5 minutes or at speaker changes, depending on guidelines.', 'Only at the beginning.', 'Only at the end.'], ans: 1 },
      { q: 'What do you do if you realize you missed a word earlier in the audio?', opts: ['Leave it.', 'Go back and insert it to ensure high accuracy.', 'Add it at the end.', 'Add a comment.'], ans: 1 },
      { q: 'If a speaker spells out a word (e.g., A-P-P-L-E), how is it formatted?', opts: ['Apple', 'A-P-P-L-E or capitalized with hyphens.', 'a p p l e', 'apple'], ans: 1 },
      { q: 'How should strong profanity be handled?', opts: ['Censor it with asterisks.', 'Transcribe it exactly as spoken unless guidelines explicitly say to censor.', 'Delete the word.', 'Replace with [profanity].'], ans: 1 },
      { q: 'If a speaker is quoting someone else, you should:', opts: ['Use quotation marks around the quoted speech.', 'Ignore it.', 'Use italics.', 'Start a new paragraph.'], ans: 0 },
      { q: 'Why is proofreading your transcript before submission crucial?', opts: ['To catch typos and ensure tags and formatting are correct.', 'To change the speaker\'s meaning.', 'To add more words.', 'It is not necessary.'], ans: 0 },
    ],
    'Data Entry': [
      { q: 'What should you do if a handwritten number on a form is completely illegible?', opts: ['Guess the number.', 'Use the [unclear] or designated missing tag.', 'Leave it blank without flagging.', 'Delete the row.'], ans: 1 },
      { q: 'If a date is written as 12/05/2023 but the form asks for YYYY-MM-DD, how do you enter it?', opts: ['Convert it to the requested format if the guideline specifies.', 'Enter exactly as seen.', 'Skip the field.', 'Enter today\'s date.'], ans: 0 },
      { q: 'When extracting a total amount from a receipt, you notice a calculation error on the receipt itself. What do you enter?', opts: ['Fix the calculation.', 'Enter the exact total written on the receipt.', 'Leave it blank.', 'Flag the receipt as invalid.'], ans: 1 },
      { q: 'If a field is blank on the source document, you should:', opts: ['Guess the answer.', 'Leave the corresponding field blank or use the specific "N/A" code.', 'Enter "None".', 'Enter 0.'], ans: 1 },
      { q: 'How should you handle spelling mistakes in names on a form?', opts: ['Correct the spelling.', 'Type them exactly as they appear on the form.', 'Skip the field.', 'Ask a supervisor.'], ans: 1 },
      { q: 'What is the standard protocol for entering phone numbers?', opts: ['Format them however you want.', 'Use the format specified in the project guidelines.', 'Always include country codes even if absent.', 'Spell them out in words.'], ans: 1 },
      { q: 'If a document has multiple addresses but the form only asks for one, which do you pick?', opts: ['Pick the first one.', 'Follow the project rule (e.g., pick billing over shipping).', 'Combine them.', 'Skip it.'], ans: 1 },
      { q: 'How do you handle currency symbols when entering numerical amounts?', opts: ['Always include them.', 'Omit them unless the field specifically requires the symbol.', 'Change them to USD.', 'Spell out the currency.'], ans: 1 },
      { q: 'When a document is too blurry to read entirely, you should:', opts: ['Guess the contents.', 'Flag the entire task as unreadable/corrupted.', 'Enter what you can and guess the rest.', 'Ignore the blurriness.'], ans: 1 },
      { q: 'If an address spans multiple lines on the source, how is it typically entered?', opts: ['Concatenated into a single line with appropriate commas, or split into specific fields.', 'Just enter the first line.', 'Ignore the zip code.', 'Enter it exactly with line breaks.'], ans: 0 },
      { q: 'What should you do if the source document is in a language you don\'t understand?', opts: ['Use Google Translate to guess.', 'Flag it as foreign language/unsupported.', 'Enter what looks like names.', 'Skip it silently.'], ans: 1 },
      { q: 'When entering email addresses, case sensitivity is:', opts: ['Always strictly enforced.', 'Usually ignored, but standard practice is to enter in all lowercase unless specified.', 'Random.', 'Capitalize the first letter.'], ans: 1 },
      { q: 'If you spot a signature instead of a printed name, and the field asks for "Printed Name", you should:', opts: ['Transcribe the signature.', 'Leave it blank or mark [signature] if required.', 'Type "Signed".', 'Guess the name.'], ans: 1 },
      { q: 'Why is double-checking your numeric entries important?', opts: ['It isn\'t important.', 'Because one wrong digit completely invalidates data like IDs or amounts.', 'To increase word count.', 'To practice typing.'], ans: 1 },
      { q: 'If a receipt contains non-essential promotional text, do you extract it?', opts: ['Yes, extract everything.', 'No, extract only the required data points.', 'Extract it in the notes section.', 'Only if it has a discount code.'], ans: 1 },
    ],
    'Image Labeling': [
      { q: 'What is the general rule for drawing a bounding box around an object?', opts: ['It should loosely enclose the object.', 'It should tightly enclose the visible parts of the object without cutting it off.', 'It should only cover the center.', 'It should be a perfect square.'], ans: 1 },
      { q: 'If a car is partially blocked (occluded) by a tree, how should you label it?', opts: ['Label the whole car, including the tree.', 'Label only the visible parts or estimate the full extent depending on specific project guidelines.', 'Don\'t label the car at all.', 'Label the tree instead.'], ans: 1 },
      { q: 'When an object is cut off by the edge of the image (truncated), you should:', opts: ['Ignore the object.', 'Draw the box up to the edge of the image.', 'Guess where the object ends outside the image.', 'Draw a box only in the middle.'], ans: 1 },
      { q: 'Should shadows of an object be included inside the bounding box?', opts: ['Always yes.', 'No, shadows are typically excluded unless specifically requested.', 'Only if they are dark.', 'Only for people.'], ans: 1 },
      { q: 'If an image is completely dark and no objects are visible, what is the best action?', opts: ['Guess where objects might be.', 'Flag or skip the image as invalid/corrupted.', 'Draw random boxes.', 'Label the darkness.'], ans: 1 },
      { q: 'How do you label a crowd of people standing very close together?', opts: ['Draw one giant box for the crowd unless told otherwise.', 'Draw individual boxes for each person if possible, or a group box if guidelines dictate.', 'Ignore crowds.', 'Label only the tallest people.'], ans: 1 },
      { q: 'If an object is reflected in a mirror, do you label the reflection?', opts: ['Yes, always.', 'Generally no, unless the project specifically asks for reflections.', 'Only if it\'s a car.', 'Label the mirror instead.'], ans: 1 },
      { q: 'When classifying a bounding box, you realize the object fits two categories. What should you do?', opts: ['Pick the first one alphabetically.', 'Choose the most specific/dominant category or follow hierarchy rules.', 'Label it twice.', 'Leave it unlabeled.'], ans: 1 },
      { q: 'What is a "tight" bounding box?', opts: ['A box where all four edges touch the outermost pixels of the target object.', 'A box that is very small.', 'A box that cuts off the edges.', 'A box drawn quickly.'], ans: 0 },
      { q: 'If a vehicle is towing a trailer, how are they typically labeled?', opts: ['As one giant box.', 'As two separate bounding boxes for vehicle and trailer.', 'Only label the vehicle.', 'Only label the trailer.'], ans: 1 },
      { q: 'Why is consistency important across all images?', opts: ['It looks better.', 'AI models require consistent training data to learn accurate patterns.', 'To save time.', 'It doesn\'t matter.'], ans: 1 },
      { q: 'If an object is extremely small, should it be labeled?', opts: ['Always.', 'Only if it exceeds the minimum pixel size limit set by the project.', 'Never.', 'Only if it\'s moving.'], ans: 1 },
      { q: 'What should you do if you are unsure what an object is?', opts: ['Guess.', 'Zoom in, use context, or flag it for review if it cannot be identified.', 'Ignore it.', 'Label it as a person.'], ans: 1 },
      { q: 'When drawing a polygon mask instead of a box, what is the key requirement?', opts: ['Draw a rough circle.', 'Trace the exact outline of the object closely.', 'Use as few points as possible regardless of shape.', 'Make it a perfect hexagon.'], ans: 1 },
      { q: 'Are antennas or side mirrors included in a vehicle\'s bounding box?', opts: ['No, never.', 'Usually yes, as they are part of the vehicle\'s physical extent.', 'Only the left mirror.', 'Only the antenna.'], ans: 1 },
    ],
    'Content Review': [
      { q: 'What constitutes hate speech according to most content policies?', opts: ['Attacks or slurs based on race, religion, sexual orientation, or other protected characteristics.', 'Disagreeing with someone politically.', 'Using profanity.', 'Insulting a brand.'], ans: 0 },
      { q: 'If a post contains graphic violence in a news context, how is it typically handled?', opts: ['Always deleted.', 'It may be allowed but age-restricted or marked sensitive, depending on policy.', 'Promoted.', 'Ignored.'], ans: 1 },
      { q: 'When reviewing potential spam, what is a key indicator?', opts: ['Long paragraphs.', 'Repetitive promotional links or irrelevant commercial content.', 'Spelling mistakes.', 'Using emojis.'], ans: 1 },
      { q: 'If a user threatens self-harm, what is the immediate action?', opts: ['Delete the post and move on.', 'Escalate to the emergency/safety team immediately.', 'Reply to the user.', 'Ignore it.'], ans: 1 },
      { q: 'How do you handle a post that is highly offensive but doesn\'t violate any specific rule?', opts: ['Delete it anyway.', 'Allow it; moderation is based on strict rules, not personal offense.', 'Suspend the user.', 'Edit the post.'], ans: 1 },
      { q: 'What should you do with suspected child exploitation material (CSAM)?', opts: ['Review it carefully.', 'Block immediately and escalate via the strict legal protocol.', 'Delete it silently.', 'Ask a coworker.'], ans: 1 },
      { q: 'If an image contains nudity but is clearly educational or medical, is it allowed?', opts: ['Never.', 'It depends on the specific platform policy regarding educational exceptions.', 'Always.', 'Only if it is drawn.'], ans: 1 },
      { q: 'How do you review content in a language you don\'t speak?', opts: ['Guess the meaning.', 'Use translation tools, or route it to a native speaker queue.', 'Approve it automatically.', 'Reject it automatically.'], ans: 1 },
      { q: 'When a user posts someone else\'s personal information (doxxing), you should:', opts: ['Verify if the info is true.', 'Remove it as a privacy violation.', 'Leave it if it\'s public record.', 'Send an email to the person.'], ans: 1 },
      { q: 'If a post contains misinformation about a harmless topic (e.g., "the moon is cheese"), is it usually removed?', opts: ['Yes, all misinformation is removed.', 'No, only harmful misinformation (e.g., medical or voting) is typically removed.', 'Yes, if reported.', 'No, unless it goes viral.'], ans: 1 },
      { q: 'What is the "borderline" content rule?', opts: ['Content that comes close to violating rules but doesn\'t cross the line is usually allowed or demoted.', 'Content about borders.', 'Content that is perfectly safe.', 'Content that is definitely illegal.'], ans: 0 },
      { q: 'Why is context important in content moderation?', opts: ['It isn\'t.', 'Because a word might be a slur in one context but a reclaimed term in another.', 'To make reviews take longer.', 'To write better reports.'], ans: 1 },
      { q: 'If you encounter a coordinated harassment campaign, what is the best step?', opts: ['Ban everyone immediately.', 'Flag the accounts involved for higher-level review.', 'Ignore it.', 'Join the campaign.'], ans: 1 },
      { q: 'What is your role as a content reviewer?', opts: ['To enforce your own morals.', 'To objectively apply the platform\'s policies to user content.', 'To argue with users.', 'To rewrite posts.'] , ans: 1},
      { q: 'How should copyright infringement be handled?', opts: ['Search for copyright proof proactively.', 'Typically only via formal DMCA requests, not proactive moderation.', 'Delete anything that looks professional.', 'Ignore it completely.'], ans: 1 },
    ],
    'Translation': [
      { q: 'What is the most important goal of translation?', opts: ['To translate word-for-word.', 'To convey the original meaning accurately and naturally in the target language.', 'To make the text shorter.', 'To add your own opinions.'], ans: 1 },
      { q: 'How should you translate cultural idioms or slang?', opts: ['Translate literally.', 'Find an equivalent idiom in the target language or translate the meaning.', 'Omit them.', 'Leave them in English.'], ans: 1 },
      { q: 'If a brand name (e.g., "Apple") is used in the text, you should:', opts: ['Translate it to the local word for fruit.', 'Keep it in English or its original trademarked form.', 'Lowercase it.', 'Remove it.'], ans: 1 },
      { q: 'How do you handle formatting tags (like <b> or <br>) in the source text?', opts: ['Delete them.', 'Preserve them exactly in the translated text.', 'Change them to Markdown.', 'Move them to the end.'], ans: 1 },
      { q: 'If the source text contains a typo, what should you do?', opts: ['Translate the typo literally.', 'Translate the intended meaning and ignore the typo.', 'Add a note to the translation.', 'Skip the sentence.'], ans: 1 },
      { q: 'When translating measurements (e.g., miles to kilometers), should you convert them?', opts: ['Always.', 'Only if the project guidelines explicitly require localization.', 'Never.', 'Only for temperature.'], ans: 1 },
      { q: 'What tone should you use for an e-commerce product description?', opts: ['Academic and dry.', 'Engaging, friendly, and persuasive, matching the source.', 'Aggressive.', 'Poetic.'], ans: 1 },
      { q: 'If a word has no direct translation, you should:', opts: ['Invent a new word.', 'Describe the concept concisely in the target language.', 'Skip it.', 'Leave it in the source language without explanation.'], ans: 1 },
      { q: 'How do you maintain consistency in a large document?', opts: ['Guess the terms.', 'Use a glossary or translation memory to ensure terms are translated the same way every time.', 'Use different words to keep it interesting.', 'Don\'t worry about consistency.'], ans: 1 },
      { q: 'What is "machine translation post-editing" (MTPE)?', opts: ['Writing code for AI.', 'Reviewing and correcting text that was initially translated by AI.', 'Translating without computers.', 'Translating only machine manuals.'], ans: 1 },
      { q: 'If the source text is ambiguous, what is the best approach?', opts: ['Guess randomly.', 'Ask for clarification or use the most contextually logical interpretation.', 'Translate both meanings.', 'Delete the sentence.'], ans: 1 },
      { q: 'How should dates be translated?', opts: ['Always US format.', 'Format them according to the standard convention of the target locale.', 'Leave them exactly as written.', 'Spell out the numbers.'], ans: 1 },
      { q: 'Why is literal (word-for-word) translation often bad?', opts: ['It is too fast.', 'Because sentence structures and grammar rules differ between languages.', 'It uses too many words.', 'It is actually the best method.'], ans: 1 },
      { q: 'When translating legal documents, what is crucial?', opts: ['Creativity.', 'Absolute precision; use exact legal terminology.', 'Making it sound modern.', 'Summarizing long clauses.'], ans: 1 },
      { q: 'Should you add explanatory notes to the translated text?', opts: ['Always.', 'No, unless specified; the translation should stand alone.', 'Only if you disagree with the text.', 'Yes, in parentheses.'], ans: 1 },
    ],
    'Research': [
      { q: 'What is the primary requirement when verifying business details?', opts: ['Use Wikipedia.', 'Only use official or highly credible public sources.', 'Call them immediately.', 'Guess based on location.'], ans: 1 },
      { q: 'If a business\'s website lists one phone number but their social media lists another, which is preferred?', opts: ['Social media.', 'The official website is usually the primary source of truth.', 'Neither.', 'Add both together.'], ans: 1 },
      { q: 'What should you do if a business appears to be permanently closed?', opts: ['Ignore it.', 'Mark it as closed/inactive according to guidelines.', 'Enter old data.', 'Delete the task.'], ans: 1 },
      { q: 'How do you handle a website link that returns a 404 error?', opts: ['Mark the URL as invalid or missing.', 'Enter it anyway.', 'Fix the URL yourself.', 'Use the homepage instead.'], ans: 0 },
      { q: 'When recording a source URL, what is important?', opts: ['Copy only the domain name.', 'Copy the exact link to the specific page where the information was found.', 'Shorten it with bit.ly.', 'Type it from memory.'], ans: 1 },
      { q: 'If a business has multiple locations, which address do you record?', opts: ['The closest one to you.', 'The headquarters or the specific branch requested in the task.', 'All of them.', 'None.'], ans: 1 },
      { q: 'Is it acceptable to use paid databases or paywalled sites?', opts: ['Yes, always.', 'No, rely on freely accessible public information.', 'Only if it\'s cheap.', 'Yes, if you have an account.'], ans: 1 },
      { q: 'How should you format a collected phone number?', opts: ['However it appears.', 'Include the country and area code in the specified format.', 'Remove all area codes.', 'Use letters.'], ans: 1 },
      { q: 'What if you cannot find any information about a business online?', opts: ['Make it up.', 'Mark the task as "Cannot Verify" or "Not Found".', 'Use a fake number.', 'Leave it blank without a tag.'], ans: 1 },
      { q: 'When extracting a contact email, which should you prioritize?', opts: ['A direct contact email over a generic "info@" if both are available, unless told otherwise.', 'The "info@" email always.', 'The webmaster\'s email.', 'The CEO\'s personal email.'], ans: 0 },
      { q: 'Can Wikipedia be used as a primary source for business details?', opts: ['Yes, it is very reliable.', 'No, always seek the company\'s official site or official registries.', 'Only for phone numbers.', 'Yes, if it has a logo.'], ans: 1 },
      { q: 'What does cross-referencing mean in research tasks?', opts: ['Checking multiple sources to confirm the information matches.', 'Referencing across the page.', 'Using a cross shape.', 'Deleting references.'], ans: 0 },
      { q: 'If pricing information varies across different competitor sites, you should:', opts: ['Average them.', 'Record the exact price shown on each specific site as requested.', 'Pick the lowest price.', 'Pick the highest price.'], ans: 1 },
      { q: 'When identifying a company\'s CEO, what is the best source?', opts: ['A random blog post.', 'The "About Us" or "Leadership" page on their official website.', 'A 10-year-old news article.', 'Guessing based on the founder.'], ans: 1 },
      { q: 'Why is attention to detail critical in research?', opts: ['It isn\'t.', 'Entering incorrect data defeats the entire purpose of data verification.', 'To make the task take longer.', 'To impress the client.'], ans: 1 },
    ]
  }

  // Fallback generic questions
  const generic = Array.from({ length: 15 }).map((_, i) => ({
    q: `General Question ${i + 1}: What is a key principle of task accuracy?`,
    opts: ['Following instructions carefully and verifying details.', 'Rushing to finish quickly.', 'Guessing when unsure.', 'Ignoring the provided guidelines.'],
    ans: 0
  }))

  const rawQuestions = banks[category as string] || generic

  return rawQuestions.map((rq, idx) => ({
    id: idx + 1,
    question: rq.q,
    options: rq.opts,
    correctIndex: rq.ans
  }))
}

export function AssessmentQuiz({ category, onPass, customQuestions }: { category: JobCategory; onPass: () => void; customQuestions?: AssessmentQuestion[] }) {
  // Admin-authored questions win; otherwise the built-in per-category bank.
  const questions = useMemo(() => {
    const authored = (customQuestions ?? [])
      .map((question, index) => ({
        id: index + 1,
        question: String(question?.question ?? '').trim(),
        options: (Array.isArray(question?.options) ? question.options : []).map((option) => String(option)).filter(Boolean),
        correctIndex: Number(question?.correctIndex ?? 0) || 0,
      }))
      .filter((question) => question.question && question.options.length >= 2 && question.correctIndex < question.options.length)
    if (authored.length > 0) return authored
    return generateQuestions(category)
  }, [customQuestions, category])

  const passMark = assessmentPassMark(questions.length)

  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [passed, setPassed] = useState(false)
  const [score, setScore] = useState(0)

  const handleSelect = (qId: number, oIdx: number) => {
    if (submitted) return
    setAnswers(prev => ({ ...prev, [qId]: oIdx }))
  }

  const handleSubmit = () => {
    let finalScore = 0
    questions.forEach(q => {
      if (answers[q.id] === q.correctIndex) finalScore++
    })

    setScore(finalScore)
    setSubmitted(true)
    if (finalScore >= passMark) {
      setPassed(true)
    }
  }

  if (passed) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 rounded-xl border border-success/30 bg-success/5">
        <CheckCircle2 className="size-16 text-success" />
        <h3 className="text-2xl font-bold text-success-foreground">Assessment Passed!</h3>
        <p className="text-muted-foreground text-center max-w-md">
          You scored {score}/{questions.length} — at or above the {passMark}/{questions.length} pass mark — and demonstrated your skills for {category} tasks.
        </p>
        <Button onClick={onPass} size="lg" className="mt-4 px-8">
          Proceed to Application
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl bg-card p-6 border border-border shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-border">
          <div>
            <h3 className="text-xl font-bold">Skill Assessment</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Category: {category}
            </p>
          </div>
          <div className="flex items-center gap-2 bg-accent/50 px-3 py-1.5 rounded-lg text-sm font-medium">
            <AlertCircle className="size-4 text-primary" />
            <span>Pass mark: {passMark}/{questions.length}</span>
          </div>
        </div>

        <div className="flex flex-col gap-10">
          {questions.map((q, i) => (
            <div key={q.id} className="flex flex-col gap-4">
              <p className="font-semibold text-base leading-relaxed text-foreground">
                <span className="text-muted-foreground mr-2">{i + 1}.</span>
                {q.question}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map((opt, oIdx) => {
                  const isSelected = answers[q.id] === oIdx
                  const isCorrect = q.correctIndex === oIdx
                  
                  let optionClass = "flex items-start gap-3 p-4 rounded-xl border text-left text-sm transition-all duration-200 "
                  if (!submitted) {
                    optionClass += isSelected 
                      ? "border-primary bg-primary/10 text-primary font-medium ring-1 ring-primary/20" 
                      : "border-border bg-card hover:border-primary/40 hover:bg-accent/30"
                  } else {
                    if (isCorrect) {
                      optionClass += "border-success bg-success/15 text-success-foreground font-medium ring-1 ring-success/30"
                    } else if (isSelected) {
                      optionClass += "border-destructive bg-destructive/15 text-destructive-foreground font-medium ring-1 ring-destructive/30"
                    } else {
                      optionClass += "border-border bg-card/50 opacity-40 grayscale"
                    }
                  }

                  return (
                    <button
                      key={oIdx}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleSelect(q.id, oIdx)}
                      className={optionClass}
                    >
                      <div className="mt-0.5 shrink-0">
                        {isSelected ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                      </div>
                      <span className="leading-snug">{opt}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {!submitted ? (
          <div className="mt-10 pt-8 border-t border-border flex flex-col items-center gap-3">
            <Button 
              size="lg" 
              onClick={handleSubmit} 
              disabled={Object.keys(answers).length < questions.length}
              className="w-full sm:w-auto min-w-[240px] shadow-md"
            >
              Submit Answers
            </Button>
            <p className="text-xs text-muted-foreground font-medium">
              Answered {Object.keys(answers).length} of {questions.length} questions
            </p>
          </div>
        ) : (
          <div className="mt-10 pt-8 border-t border-border flex flex-col items-center gap-4 bg-destructive/5 rounded-xl p-6">
            <p className="text-destructive font-bold text-lg flex items-center gap-2">
              <AlertCircle className="size-5" />
              You scored {score}/{questions.length} — the pass mark is {passMark}/{questions.length}.
            </p>
            <p className="text-sm text-muted-foreground text-center">
              Please review the training notes and guidelines, then try again.
            </p>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setAnswers({})
                setSubmitted(false)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="mt-2 w-full sm:w-auto min-w-[200px]"
            >
              Retake Assessment
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
