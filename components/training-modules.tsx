import { CheckCircle2, BookOpen, AlertTriangle, Settings, FileText } from 'lucide-react'
import type { Job } from '@/lib/afterworks-data'

export function TrainingModules({ job }: { job: Job }) {
  const contentMap: Record<string, any[]> = {
    'Transcription': [
      {
        title: 'Module 1: Introduction & Core Objective',
        icon: <BookOpen className="size-5 text-primary" />,
        text: `In this role, you will be transcribing audio files into text. The core objective is capturing every spoken word accurately while adhering to the specified verbatim style. Your work directly trains voice recognition models and provides accessibility, making precision critical. \n\n**Job specifics:** ${job.description}`
      },
      {
        title: 'Module 2: Quality Standards & QA',
        icon: <CheckCircle2 className="size-5 text-success" />,
        text: 'Our Quality Assurance (QA) team regularly audits submissions. We expect a minimum of 98% accuracy. This means correct spelling, proper punctuation, and accurate speaker identification. Falling below this threshold consistently will result in account suspension.'
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        icon: <AlertTriangle className="size-5 text-warning" />,
        text: 'Expect to encounter overlapping speech, thick accents, and heavy background noise. \n- **Overlapping Speech:** Always use separate speaker labels with exact timestamps.\n- **Unintelligible Audio:** If you cannot understand a word after listening 3 times, use the `[inaudible]` or `[unclear]` tag.\n- **Stutters/Filler Words:** Follow the project guidelines (strict verbatim requires capturing "um" and "uh", clean verbatim requires removing them).'
      },
      {
        title: 'Module 4: Formatting Guidelines',
        icon: <Settings className="size-5 text-primary" />,
        text: 'Always format speaker changes on a new line (e.g., "Speaker 1:"). Timestamps should be added at every speaker change or every 2 minutes of continuous speech unless instructed otherwise. Spell out numbers one through nine, and use numerals for 10 and above.'
      }
    ],
    'Data Entry': [
      {
        title: 'Module 1: Introduction & Core Objective',
        icon: <BookOpen className="size-5 text-primary" />,
        text: `You will be extracting structured data from receipts, invoices, and handwritten forms. Your core objective is to digitize analog information exactly as it appears on the source document. \n\n**Job specifics:** ${job.description}`
      },
      {
        title: 'Module 2: Quality Standards & QA',
        icon: <CheckCircle2 className="size-5 text-success" />,
        text: 'Data entry demands 100% accuracy, especially on numeric fields like IDs, phone numbers, and financial totals. A single wrong digit invalidates the entire record. QA will sample your work, and precision is prioritized over speed.'
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        icon: <AlertTriangle className="size-5 text-warning" />,
        text: 'You will frequently see illegible handwriting, missing dates, or calculation errors on receipts.\n- **Errors on Source:** If a receipt total is calculated wrong, enter the total *exactly as written* on the receipt, do not fix their math.\n- **Blank Fields:** If a field is empty, leave the entry blank or use the designated N/A code. Do not guess.\n- **Illegible Text:** Use the `[unclear]` tag for completely unreadable words.'
      },
      {
        title: 'Module 4: Formatting Guidelines',
        icon: <Settings className="size-5 text-primary" />,
        text: 'Always format dates strictly as YYYY-MM-DD regardless of how they appear on the form (unless otherwise instructed). Omit currency symbols ($, €, £) from numeric amount fields. Ensure email addresses are entered in lowercase without trailing spaces.'
      }
    ],
    'Image Labeling': [
      {
        title: 'Module 1: Introduction & Core Objective',
        icon: <BookOpen className="size-5 text-primary" />,
        text: `Your task is to draw precise bounding boxes or polygons around objects of interest in images. This data is used to train computer vision AI models (like self-driving cars or medical imaging). \n\n**Job specifics:** ${job.description}`
      },
      {
        title: 'Module 2: Quality Standards & QA',
        icon: <CheckCircle2 className="size-5 text-success" />,
        text: 'The most important metric is "tightness". A bounding box must tightly enclose the visible parts of the object—all four edges of the box should touch the outermost pixels of the target object. Loose boxes or boxes that cut off the object will be rejected by QA.'
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        icon: <AlertTriangle className="size-5 text-warning" />,
        text: 'You must correctly handle occlusion and truncation.\n- **Occlusion:** If a car is partially blocked by a tree, only draw the box around the *visible* parts of the car.\n- **Truncation:** If an object is cut off by the edge of the image, draw the box exactly up to the edge.\n- **Shadows/Reflections:** Exclude shadows and mirror reflections from your bounding boxes unless explicitly asked to include them.'
      },
      {
        title: 'Module 4: Tooling & Categorization',
        icon: <Settings className="size-5 text-primary" />,
        text: 'Ensure you select the most specific category available for an object. If a vehicle is towing a trailer, draw two separate bounding boxes (one for the vehicle, one for the trailer). Do not label objects that are too small to identify without extreme zooming.'
      }
    ],
    'Content Review': [
      {
        title: 'Module 1: Introduction & Core Objective',
        icon: <BookOpen className="size-5 text-primary" />,
        text: `You will evaluate user-generated text, images, or videos against platform safety policies. Your core objective is to maintain a safe environment by accurately identifying and actioning violating content. \n\n**Job specifics:** ${job.description}`
      },
      {
        title: 'Module 2: Quality Standards & QA',
        icon: <CheckCircle2 className="size-5 text-success" />,
        text: 'Reviewers must remain 100% objective. You must separate your personal biases or offense from the written policy. QA audits rely entirely on whether your decision matches the strict letter of the platform guidelines.'
      },
      {
        title: 'Module 3: Edge Cases & Escalations',
        icon: <AlertTriangle className="size-5 text-warning" />,
        text: 'Not all content is black and white.\n- **Borderline Content:** Content that is highly offensive but doesn\'t technically cross the line into hate speech or harassment must usually be allowed.\n- **Context Matters:** A word might be a slur in one context, but a reclaimed term or historical reference in another.\n- **Escalations:** Any indication of imminent self-harm, terrorism, or CSAM must be immediately escalated through the emergency protocol.'
      },
      {
        title: 'Module 4: Tagging Guidelines',
        icon: <Settings className="size-5 text-primary" />,
        text: 'When removing content, you must apply the correct violation tag (e.g., "Hate Speech", "Spam", "Harassment"). If multiple violations exist, choose the most severe one. Always leave clear, concise audit notes if the decision was ambiguous.'
      }
    ],
    'Translation': [
      {
        title: 'Module 1: Introduction & Core Objective',
        icon: <BookOpen className="size-5 text-primary" />,
        text: `You will translate text from a source language to a target language. The objective is to convey the original meaning accurately, naturally, and fluently in the target language. \n\n**Job specifics:** ${job.description}`
      },
      {
        title: 'Module 2: Quality Standards & QA',
        icon: <CheckCircle2 className="size-5 text-success" />,
        text: 'Literal, word-for-word translation is unacceptable because grammar rules differ between languages. QA grades based on meaning preservation, natural flow, and adherence to the intended tone (e.g., formal legal vs. casual marketing).'
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        icon: <AlertTriangle className="size-5 text-warning" />,
        text: 'You will encounter cultural idioms and untranslatable concepts.\n- **Idioms:** Never translate idioms literally (e.g., "it\'s raining cats and dogs"). Find an equivalent idiom in the target language or simply translate the underlying meaning.\n- **Typos in Source:** If the source text contains a typo, ignore it and translate the *intended* meaning.\n- **Ambiguity:** Use contextual clues to resolve ambiguous sentences rather than guessing.'
      },
      {
        title: 'Module 4: Formatting & Localization',
        icon: <Settings className="size-5 text-primary" />,
        text: 'Always preserve HTML formatting tags (like `<b>` or `<br>`) exactly as they appear. Do not translate trademarked brand names unless they have an established localized name. Convert dates and measurements to match the standard conventions of the target locale if instructed.'
      }
    ],
    'Research': [
      {
        title: 'Module 1: Introduction & Core Objective',
        icon: <BookOpen className="size-5 text-primary" />,
        text: `You will verify, find, and update business contact details or specific data points using web searches. The goal is to build a highly accurate, up-to-date database. \n\n**Job specifics:** ${job.description}`
      },
      {
        title: 'Module 2: Quality Standards & QA',
        icon: <CheckCircle2 className="size-5 text-success" />,
        text: 'Accuracy and source credibility are paramount. Entering incorrect data defeats the purpose of verification. QA will check your submitted data against the exact source URL you provide to ensure they match perfectly.'
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        icon: <AlertTriangle className="size-5 text-warning" />,
        text: 'Information online is often conflicting or outdated.\n- **Conflicting Info:** If a business\'s website lists one phone number but their Facebook page lists another, the official website is your primary source of truth.\n- **Dead Links:** If a link returns a 404 error, mark the field as invalid/missing.\n- **Not Found:** If you cannot find any credible info after a thorough search, use the "Cannot Verify" tag rather than guessing.'
      },
      {
        title: 'Module 4: Sourcing Guidelines',
        icon: <Settings className="size-5 text-primary" />,
        text: 'Only use official company websites or credible public registries. Wikipedia and random blogs are not primary sources. Always copy the *exact* deep-link URL where you found the information, not just the homepage. Format phone numbers with appropriate country codes.'
      }
    ]
  }

  // Fallback for generic jobs
  const genericModules = [
    {
      title: 'Module 1: Job Overview',
      icon: <BookOpen className="size-5 text-primary" />,
      text: `Please review the specific requirements for this task carefully. \n\n**Job specifics:** ${job.description}`
    },
    {
      title: 'Module 2: Quality & Accuracy',
      icon: <CheckCircle2 className="size-5 text-success" />,
      text: 'QA will sample your work to ensure it meets our accuracy standards. Take your time, follow instructions precisely, and do not rush.'
    },
    {
      title: 'Module 3: Edge Cases',
      icon: <AlertTriangle className="size-5 text-warning" />,
      text: 'If you encounter a scenario not covered in the instructions, please use your best judgment, flag the task for review, or use the `[unclear]` tag where applicable.'
    },
    {
      title: 'Module 4: Submission Guidelines',
      icon: <FileText className="size-5 text-primary" />,
      text: 'Ensure all required fields are filled out before submitting. Double-check your work for typos or formatting errors.'
    }
  ]

  const modules = contentMap[job.category] || genericModules

  return (
    <div className="flex flex-col gap-6">
      {modules.map((mod, i) => (
        <div key={i} className="rounded-xl border border-border bg-accent/10 p-6 shadow-sm">
          <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
            {mod.icon}
            {mod.title}
          </h3>
          <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {mod.text}
          </div>
        </div>
      ))}
    </div>
  )
}
