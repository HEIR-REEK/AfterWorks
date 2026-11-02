import { lesson, type TrainingCourse } from '@/lib/training-course-model'

export const IMAGE_LABELING: TrainingCourse = {
  level: 'Beginner friendly · no prior experience',
  summary:
    'Teach a model what is in an image by drawing accurate boxes and applying the right class. Learn tightness, occlusion, truncation, and the review pass that catches expensive label errors.',
  objectives: [
    'Choose the most specific class and draw a box around the visible pixels.',
    'Handle occlusion, shadows, groups, and objects cut off by the frame.',
    'Run a review pass for missed objects, loose edges, and duplicate labels.',
    'Keep ambiguous cases consistent instead of guessing from project to project.',
  ],
  heroImage: '/training/labeling-overview.svg',
  heroAlt:
    'A street scene with tight boxes around a car and a pedestrian, plus a toolbar for choosing a class and drawing tight boxes.',
  heroCaption: 'The model learns from exactly what you box — including your mistakes.',
  modules: [
    lesson(
      'Why a box is a promise',
      6,
      `
### What you are producing

An image label is a small training example. You tell the model: this is the object, this is its class, and this is where it starts and ends in the image. A thousand correct boxes teach a useful detector. A hundred loose boxes teach it to include the road, the shadow, and the sky.

### The two decisions in every label

1. **What is it?** Pick the most specific class the project allows. A sedan is a car; a delivery van may be a truck or a van depending on the class list.
2. **Where is it?** Draw the smallest box that still contains every visible pixel of the object. The box should touch the outer edges, not float around them.

### What the model cannot learn from you

It cannot learn that a box was “roughly right”. It cannot learn that you meant the object behind the tree. It learns the pixels inside the box and the class you attached. That is why tightness and consistency matter more than artistic judgement.

**A label is a promise about pixels. Keep it.**
`,
      {
        check: {
          question: 'What does the model learn from a bounding box?',
          options: [
            'The object’s name and the exact pixels inside the box',
            'The story behind the image',
            'The photographer’s intent',
            'Only the object’s colour',
          ],
          correctIndex: 0,
          explanation:
            'The class and the pixels inside the box are the training signal. A loose box teaches the model to include background.',
        },
      },
    ),
    lesson(
      'The labeling workflow: class, box, review',
      8,
      `
### 1. Read the class list before the first image

The class list is the vocabulary. Read the definitions and examples, especially for classes that sound similar: car vs truck, person vs rider, sign vs logo. If a class is not on the list, it does not get a label just because it is interesting.

### 2. Scan the whole image first

Before drawing, look across the image for every instance of every class. Start with the large, obvious objects, then scan the edges and background. Missing an object is usually more damaging than a slightly loose box, because the model learns that the object is background.

### 3. Draw the box

Start at one visible edge, drag to the opposite visible edge, and stop. Do not include the shadow, the reflection, or the space between the object and the box. If the object is partially hidden, box only the visible part; do not estimate the hidden half.

### 4. Assign the class

Use the most specific class available. If two classes seem possible, apply the project's tie-break rule. If the object is too ambiguous to classify confidently, use the project's “unknown” or “skip” option rather than inventing a new class.

### 5. Review before you move on

Zoom out and look at the box. Does it cut through the object? Does it include a large empty margin? Did you label the same object twice? Check the image edges for truncated objects you may have missed.

### 6. Save consistently

Use the tool's keyboard shortcuts and save cadence. A crash is not an excuse for a half-labeled image; save after each small group.
`,
      {
        check: {
          question: 'What should you do before drawing boxes on a new image?',
          options: [
            'Zoom in on the first object and start drawing',
            'Scan the whole image and read the class definitions',
            'Label only the largest object',
            'Guess the classes from the colours',
          ],
          correctIndex: 1,
          explanation:
            'A full scan prevents missed objects, and the class definitions prevent inconsistent labels across the batch.',
        },
      },
    ),
    lesson(
      'Tight boxes, occlusion, and truncation',
      8,
      `
### Tight does not mean tiny

A tight box touches the outer visible pixels of the object. It does not cut off a wheel, a hand, or a sign. The test is simple: if you can see object pixels outside the box, the box is too small. If you can see a band of background inside the box, it is too loose.

### Occlusion

When a tree hides half a car, box the visible half. Stop at the tree, not at where the car probably continues. If the project has an occlusion flag, set it. Do not draw a second box for the hidden part.

### Truncation

When an object is cut off by the image edge, box the part inside the frame. Do not extend the box beyond the image. If the project distinguishes truncated objects, mark it. A person walking out of frame is still a person, but only the visible part is labeled.

### Shadows, reflections, and screens

A shadow is not the object. A reflection in a window is not a second object unless the project explicitly labels reflections. An image on a billboard is not a real car. Read the class definition for these cases; when the definition is silent, follow the closest reviewed example.

### Groups and crowds

Label each visible instance separately when the project asks for instance labels. A crowd of ten people is ten boxes, not one large box around the group. If the project uses group labels, the definition will say so.

### Small objects

Zoom in. A tight box around a distant sign may be only a few pixels wide. If the object is too small to identify confidently, use the project's minimum-size rule or skip it consistently.
`,
      {
        image: '/training/labeling-boxes.svg',
        imageAlt:
          'Three car labels: a tight green box, a loose amber box that includes the road and shadow, and a blue box that stops at an occluding tree.',
        imageCaption: 'Tightness is a QA criterion, not a style preference.',
        check: {
          question: 'A car is half hidden behind a tree. How should you box it?',
          options: [
            'Box the whole car, including the hidden half',
            'Box only the visible part and stop at the tree',
            'Skip the car because it is not fully visible',
            'Draw two boxes, one for each half',
          ],
          correctIndex: 1,
          explanation:
            'Box the visible pixels. Estimating the hidden half invents pixels the model cannot see, and skipping loses a real object.',
        },
      },
    ),
    lesson(
      'Edge cases: ambiguous classes, tiny objects, and duplicates',
      8,
      `
### Two classes fit

Use the project's priority order. A rider on a bicycle may be a person and a rider; the class list will say which label the project wants. Do not choose based on which box is easier to draw. If the list gives no answer, follow the most similar reviewed example and note the ambiguity.

### An object you cannot identify

Do not invent a class. Use the approved unknown or skip option. If the image is too blurry to label, mark it for review rather than producing a confident wrong box.

### Tiny or distant objects

Apply the project's minimum-size rule consistently. If the rule says label objects larger than 10 pixels, do not label a 4-pixel speck because you happen to recognize it. Consistency across the batch is what makes the dataset usable.

### Duplicate labels

Two boxes on the same object is a common review failure. After labeling, click each box and check that it maps to a distinct instance. If you accidentally duplicate, delete the extra box rather than leaving both.

### Images with text, logos, or screens

A logo on a shirt is not a logo class unless the project says so. A person on a poster is not a person in the scene. Read the definition; visual similarity is not the same as the label's scope.

### When the image is offensive or distressing

Label the content according to the project's taxonomy, not your reaction to it. If the image contains apparent child sexual abuse material or an imminent safety risk, stop and escalate immediately through the project channel. Do not download, share, or describe the material in a public tool.
`,
    ),
    lesson(
      'Practice: review a batch of three',
      7,
      `
### Your drill

Imagine three images from a street-scene project:

- Image A: a car in the centre, fully visible, with a strong shadow to the right.
- Image B: a pedestrian at the left edge, cut off at the waist.
- Image C: two cyclists overlapping, both partially visible.

### A strong set of labels

- **A:** one tight car box that stops at the visible body and excludes the shadow.
- **B:** one pedestrian box that stops at the image edge and includes only the visible upper body; mark truncated if the project uses that flag.
- **C:** two separate cyclist boxes, each stopping at the visible pixels; no single box around the pair.

### A weak set

- A box around the car plus its shadow — teaches the model that shadows are cars.
- No pedestrian because “only half is visible” — teaches the model that edge objects are background.
- One large box around both cyclists — teaches the model that two people are one object.

### Self-check

- Did you scan the edges for truncated objects?
- Does every box touch the visible outer pixels without a background margin?
- Is every object boxed once, with the most specific class?
- Would another labeler produce the same boxes from the same class definitions?
`,
      {
        check: {
          question: 'Which label is most likely to pass QA?',
          options: [
            'A car box that includes the road and shadow',
            'A tight car box around the visible body, excluding the shadow',
            'A box around the whole image',
            'No box, because the car might move',
          ],
          correctIndex: 1,
          explanation:
            'QA checks that the box is tight to the visible object and does not include background or shadow.',
        },
      },
    ),
    lesson(
      'Submission checklist and the assessment',
      5,
      `
### Before you submit

- [ ] Every visible instance has one box and one class.
- [ ] Boxes are tight to the visible pixels, with no background margin.
- [ ] Occluded and truncated objects stop at the visible edge.
- [ ] Shadows, reflections, and images-within-images follow the class definitions.
- [ ] No duplicate boxes and no missed edge objects.
- [ ] Tiny objects follow the project's minimum-size rule.
- [ ] Distressing content was handled through the approved channel, not shared.

### The assessment

The questions use short visual scenarios: which box is tight, what to do with a half-hidden object, when a logo is not a logo, how to handle a class that could fit two labels. Two-thirds correct is a pass.

Read the explanation for every question, including the ones you get right. The explanations are the project's tie-break rules in plain language.

### On the job

Start with a small batch and review it before scaling up. If you find one systematic mistake — loose boxes, a missed class, duplicate labels — fix the batch and adjust your scan. Consistency is the skill that gets you repeat work.
`,
    ),
  ],
}
