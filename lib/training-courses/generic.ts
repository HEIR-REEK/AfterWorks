import { lesson, type TrainingCourse } from '@/lib/training-course-model'

export const GENERIC: TrainingCourse = {
  level: 'Beginner friendly',
  summary:
    'A short course in doing online work carefully: understand the brief, protect the data, check your own output, and hand in something a reviewer can defend.',
  objectives: [
    'Read a brief and identify the deliverable, the quality bar, and the deadline.',
    'Protect confidential information and use only approved tools.',
    'Run a self-review pass before submitting.',
    'Ask a precise question when the brief is ambiguous.',
  ],
  modules: [
    lesson(
      'Understand the brief before you start',
      6,
      `
### The four things every brief contains

1. **The deliverable.** A file, a row, a label, a transcript, a decision. Know the exact format.
2. **The quality bar.** What counts as done: accuracy, completeness, format, and the review rules.
3. **The scope.** What is included and, just as important, what is not.
4. **The deadline and the hand-in path.** Where the file goes and what happens if you are blocked.

### Read it twice

The first read is for the shape of the task. The second read is for the details you will otherwise discover at submission time: the file name, the column order, the required language, the exception process.

### Ask a precise question

“I don't understand” is hard to answer. “The brief says dates should be YYYY-MM-DD, but the source uses 12/05/2026 and the client is in Kenya. Should I read this as 12 May or 5 December?” is answerable.

**A short clarifying question is cheaper than a redo.**
`,
      {
        check: {
          question: 'What is the best way to handle an ambiguous instruction in a brief?',
          options: [
            'Guess and hope the reviewer agrees',
            'Ignore the instruction',
            'Ask a specific question that names the ambiguity and the options',
            'Submit two versions',
          ],
          correctIndex: 2,
          explanation:
            'A specific question gets a specific answer and creates a record of the decision.',
        },
      },
    ),
    lesson(
      'Protect the data',
      6,
      `
### Use only the approved tools

Client data belongs in the account and tools the project provides. Do not move it to a personal drive, a public chat, or a free AI tool. Do not forward it to a personal email address.

### Collect only what the task needs

If the brief asks for a business email, do not also collect a personal phone number. If a field is not required, leave it out. Extra data is extra risk.

### Keep access tidy

Use the project account, not a shared login. Do not screenshare a document with personal data in the background. Lock your device when you step away.

### If something goes wrong

Report a suspected data exposure immediately through the project channel. Do not try to quietly clean it up. A fast report is always better than a hidden incident.
`,
      {
        check: {
          question: 'You need to transcribe a client call. Which tool should you use?',
          options: [
            'A free public AI transcriber you found online',
            'The approved project tool and account',
            'Your personal cloud drive',
            'A public social media draft',
          ],
          correctIndex: 1,
          explanation:
            'Confidential data stays inside the approved tools. A public tool can expose the client and the project.',
        },
      },
    ),
    lesson(
      'Check your own work',
      7,
      `
### Self-review is a separate pass

Do not review while you produce. Finish the draft, take a short break if possible, then compare the output to the brief and the source. Your brain is much better at catching errors when it is not also trying to create.

### The three-pass review

1. **Completeness.** Is every required field, row, or section present?
2. **Accuracy.** Compare the output to the source, not to your memory of the source.
3. **Format.** File name, column order, date format, language, and submission path.

### Look for patterns

One error is a mistake. Three errors of the same kind are a process problem. Fix the process before you produce more output.

### When to stop

Stop and ask when the source is unreadable, the brief is contradictory, or the task requires a judgement you are not authorised to make. “I stopped because the source was unclear and I did not want to guess” is a professional answer.
`,
      {
        check: {
          question: 'Why should self-review be a separate pass?',
          options: [
            'It makes the task take longer',
            'Your brain catches more errors when it is not also producing',
            'It replaces the brief',
            'It guarantees no mistakes',
          ],
          correctIndex: 1,
          explanation:
            'Separating production from review makes it easier to compare the output against the source and the brief with fresh attention.',
        },
      },
    ),
    lesson(
      'Hand in work a reviewer can defend',
      5,
      `
### The hand-in

Submit one clean deliverable in the requested format. Remove scratch notes, duplicate files, and drafts. Name the file exactly as the brief asks.

### The note

If something was unclear, say what you did and why in a short note. Do not bury a caveat in a chat message the reviewer will never see. “Field 4 was blank in the source, so I left it blank per the brief's blank-field rule” is useful.

### The follow-up

If the reviewer sends a revision, fix the cause, not only the symptom. If one date was wrong, check the rest of the dates. If a whole column was off, check the mapping.

### Your reputation

Reviewers remember workers who are accurate, honest about uncertainty, and easy to communicate with. That is the real path to more work and higher pay.
`,
      {
        check: {
          question: 'What should you do if a reviewer asks you to fix one wrong value?',
          options: [
            'Change only that value and resubmit immediately',
            'Fix it, then check the rest of the batch for the same kind of error',
            'Argue that the source was unclear',
            'Start the whole task again from scratch',
          ],
          correctIndex: 1,
          explanation:
            'One reported error often signals a pattern. Fixing the cause protects the rest of the batch.',
        },
      },
    ),
  ],
}
