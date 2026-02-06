/**
 * Tanaghum Prompt Builder
 * Constructs optimized prompts for various LLM tasks
 */

import { Config } from '../core/config.js';

/**
 * ILR level descriptions for prompts
 */
const ILR_DESCRIPTIONS = {
  1.0: 'Elementary - Basic phrases, simple sentences, familiar topics',
  1.5: 'Elementary+ - Simple conversations on routine topics',
  2.0: 'Limited Working - Factual news, personal narratives, simple arguments',
  2.5: 'Limited Working+ - Standard news broadcasts, formal speeches',
  3.0: 'Professional - Political analysis, technical discussions, complex arguments',
  3.5: 'Professional+ - Nuanced content, literary references, specialized topics'
};

/**
 * Topic keywords for context
 */
const TOPIC_CONTEXT = {
  economy: 'economic topics such as inflation, markets, trade, GDP, monetary policy',
  politics: 'political topics such as elections, diplomacy, legislation, governance',
  culture: 'cultural topics such as arts, traditions, literature, music, heritage',
  science: 'scientific topics such as research, technology, discoveries, medicine',
  society: 'social topics such as demographics, community, social issues, lifestyle',
  health: 'health topics such as medicine, wellness, diseases, healthcare systems',
  education: 'educational topics such as schools, learning, curriculum, universities',
  environment: 'environmental topics such as climate, conservation, pollution, sustainability',
  general: 'general interest topics'
};

/**
 * Build a transcript correction prompt
 */
export function buildTranscriptCorrectionPrompt(transcript, options = {}) {
  const { dialect = 'msa' } = options;

  const dialectNote = dialect !== 'msa'
    ? `\nNote: This text may contain ${dialect} dialect features. Preserve dialectal vocabulary but correct errors.`
    : '';

  return {
    system: `You are an expert Arabic linguist specializing in transcript correction.
Your task is to fix errors in Arabic speech-to-text output while preserving the original meaning.

Correction guidelines:
- Fix obvious transcription errors (misheard words)
- Correct spelling and typing errors
- Add essential diacritics only where needed for meaning
- Fix word boundary errors (merged or split words)
- Preserve filler words and natural speech patterns
- Do NOT add or remove substantive content
- Do NOT paraphrase or improve style${dialectNote}

Return ONLY the corrected Arabic text with no explanations or formatting.`,

    user: `Correct this Arabic transcript:

${transcript}`
  };
}

/**
 * Build an ILR analysis prompt
 */
export function buildILRAnalysisPrompt(transcript, options = {}) {
  const { wordCount = 0, speakingRate = 0 } = options;

  const metadata = [];
  if (wordCount) metadata.push(`Word count: ${wordCount}`);
  if (speakingRate) metadata.push(`Speaking rate: ${speakingRate} words/minute`);

  return {
    system: `You are an expert in Arabic language proficiency assessment using the ILR (Interagency Language Roundtable) scale.

ILR Levels:
${Object.entries(ILR_DESCRIPTIONS).map(([level, desc]) => `- ${level}: ${desc}`).join('\n')}

Assessment criteria:
1. Vocabulary complexity (frequency, technical terms, collocations)
2. Sentence structure (length, clause complexity, subordination)
3. Discourse features (cohesion, transitions, organization)
4. Topic abstraction (concrete vs abstract, specialized knowledge)
5. Speaking rate and delivery (if applicable)

Provide a rigorous, evidence-based assessment.`,

    user: `Analyze this Arabic text for ILR proficiency level.
${metadata.length > 0 ? `\nMetadata: ${metadata.join(', ')}` : ''}

Return a JSON object with:
{
  "level": <number: 1.0, 1.5, 2.0, 2.5, 3.0, or 3.5>,
  "confidence": <number: 0.0 to 1.0>,
  "breakdown": {
    "vocabulary": <number: 0-100>,
    "syntax": <number: 0-100>,
    "discourse": <number: 0-100>,
    "abstraction": <number: 0-100>
  },
  "evidence": [<strings: specific examples from text>],
  "factors": [<strings: key factors that determined level>]
}

Text:
${transcript}`
  };
}

/**
 * Build a question generation prompt
 */
export function buildQuestionGenerationPrompt(transcript, options = {}) {
  const {
    phase = 'while',
    count = 5,
    ilrLevel = 2.0,
    topic = 'general',
    types = ['multiple_choice', 'true_false'],
    avoidSkills = []
  } = options;

  const phaseGuidelines = {
    pre: `Pre-listening questions prepare students before hearing the audio.
Goals: Activate prior knowledge, set expectations, introduce key vocabulary
Skills to test: prediction, schema_activation, vocabulary_preview
Timing: Asked before audio plays`,

    while: `While-listening questions test comprehension during playback.
Goals: Guide attention, check understanding, encourage active listening
Skills to test: main_idea, details, sequence, inference, cause_effect
Timing: Appear at specific points during audio (provide timestamp_percent 0-1)`,

    post: `Post-listening questions assess deeper understanding after completion.
Goals: Synthesize information, evaluate content, extend learning
Skills to test: vocabulary_in_context, speaker_attitude, synthesis, evaluation, comparison
Timing: Asked after audio ends`
  };

  const typeInstructions = `
Question type specifications:

multiple_choice:
- Exactly 4 options labeled a, b, c, d
- Only ONE correct answer
- Distractors should be plausible but clearly wrong
- Include: options: [{id, text_ar, text_en, is_correct: boolean}]

true_false:
- Clear statement that is definitively true or false from the text
- Include: correct_answer: boolean, justification_ar, justification_en

fill_blank:
- Sentence with ONE blank marked by ___
- Word bank of 4 options including the correct word
- Include: sentence_ar, sentence_en, word_bank: [strings], correct_word: string

open_ended:
- Requires constructed response (speaking or writing)
- Include: rubric: [evaluation criteria strings], sample_response_ar, sample_response_en`;

  return {
    system: `You are an expert Arabic language teacher creating comprehension questions.

Target proficiency: ILR ${ilrLevel} (${ILR_DESCRIPTIONS[ilrLevel] || 'Intermediate'})
Topic context: ${TOPIC_CONTEXT[topic] || 'general topics'}

${phaseGuidelines[phase]}

${typeInstructions}

Quality requirements:
- Questions must be directly answerable from the text
- Language difficulty matches ILR ${ilrLevel}
- Both Arabic and English versions for all text
- Vary question types and skills tested
- Explanations help learners understand why answer is correct`,

    user: `Create ${count} ${phase}-listening comprehension questions.

Allowed types: ${types.join(', ')}
${avoidSkills.length > 0 ? `Avoid these skills (already covered): ${avoidSkills.join(', ')}` : ''}

Return a JSON array of questions. Each question object must have:
{
  "type": "${types[0]}",
  "skill": "<skill being tested>",
  "question_ar": "<Arabic question text>",
  "question_en": "<English translation>",
  ${phase === 'while' ? '"timestamp_percent": <0-1 when question should appear>,' : ''}
  // ... type-specific fields as specified above
  "explanation_ar": "<Arabic explanation>",
  "explanation_en": "<English explanation>"
}

Source text:
${transcript}`
  };
}

/**
 * Build a vocabulary extraction prompt
 */
export function buildVocabularyExtractionPrompt(transcript, options = {}) {
  const {
    count = 10,
    ilrLevel = 2.0,
    existingWords = []
  } = options;

  return {
    system: `You are an expert Arabic vocabulary instructor.
Extract key vocabulary items appropriate for ILR ${ilrLevel} learners.

Selection criteria:
- Essential for understanding the text
- Likely to be new or challenging at this level
- High utility (useful beyond this specific text)
- Includes a mix of: nouns, verbs, adjectives, expressions

For each word provide:
- Accurate root identification
- Clear, concise definitions
- Example from the source text
- Part of speech`,

    user: `Extract ${count} key vocabulary items from this text.
${existingWords.length > 0 ? `\nExclude these already-covered words: ${existingWords.join(', ')}` : ''}

Return a JSON array where each item has:
{
  "word_ar": "<Arabic word as it appears>",
  "word_en": "<English translation>",
  "root": "<three-letter root, e.g., ك-ت-ب>",
  "pos": "<noun|verb|adjective|adverb|preposition|expression>",
  "definition_ar": "<brief Arabic definition>",
  "definition_en": "<brief English definition>",
  "example_ar": "<example sentence from text>",
  "example_en": "<English translation of example>",
  "frequency": "<high|medium|low>"
}

Text:
${transcript}`
  };
}

/**
 * Build a dialect detection prompt
 */
export function buildDialectDetectionPrompt(transcript) {
  return {
    system: `You are an expert in Arabic dialectology.
Identify the primary dialect or variety of Arabic used in the text.

Dialects to consider:
- msa: Modern Standard Arabic (formal, news, academic)
- egyptian: Egyptian Arabic (مصري)
- levantine: Levantine Arabic (شامي - Syrian, Lebanese, Palestinian, Jordanian)
- gulf: Gulf Arabic (خليجي - Saudi, Emirati, Kuwaiti, Qatari)
- maghrebi: Maghrebi Arabic (مغاربي - Moroccan, Algerian, Tunisian)

Look for:
- Distinctive vocabulary
- Pronunciation markers in transcription
- Grammatical features
- Common expressions`,

    user: `Identify the Arabic dialect/variety in this text.

Return JSON:
{
  "dialect": "<msa|egyptian|levantine|gulf|maghrebi>",
  "confidence": <0.0 to 1.0>,
  "features": [<strings: specific dialectal features observed>],
  "mixed": <boolean: true if multiple dialects present>
}

Text:
${transcript}`
  };
}

/**
 * Build a title/description generation prompt
 */
export function buildMetadataPrompt(transcript, options = {}) {
  const { topic = 'general' } = options;

  return {
    system: `You are creating metadata for an Arabic listening comprehension lesson.
Generate a concise, descriptive title and brief description.`,

    user: `Create a title and description for this ${topic} lesson.

Return JSON:
{
  "title_ar": "<Arabic title, max 60 chars>",
  "title_en": "<English title, max 60 chars>",
  "description_ar": "<Arabic description, 1-2 sentences>",
  "description_en": "<English description, 1-2 sentences>",
  "tags": [<5-8 relevant keyword tags>]
}

Text:
${transcript.substring(0, 1000)}...`
  };
}

export const PromptBuilder = {
  transcriptCorrection: buildTranscriptCorrectionPrompt,
  ilrAnalysis: buildILRAnalysisPrompt,
  questionGeneration: buildQuestionGenerationPrompt,
  vocabularyExtraction: buildVocabularyExtractionPrompt,
  dialectDetection: buildDialectDetectionPrompt,
  metadata: buildMetadataPrompt
};
