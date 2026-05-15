/**
 * Selectable voice models + voice names for the Settings drawer.
 *
 * Update this file to add a new Gemini Live model preview or a newly
 * documented voice — no other code needs to change.
 */

export interface VoiceModelOption {
  id: string;
  label: string;
  description?: string;
}

export const VOICE_MODELS: VoiceModelOption[] = [
  {
    id: "gemini-3.1-flash-live-preview",
    label: "Gemini 3.1 Flash Live",
    description: "Fast, conversational. Production default (matches Athena).",
  },
  {
    id: "gemini-2.5-flash-preview-native-audio-dialog",
    label: "Gemini 2.5 Flash (Native Audio Dialog)",
    description: "Native-audio dialog tier; supports NON_BLOCKING tools.",
  },
];

export interface VoiceNameOption {
  id: string;
  label: string;
  hint?: string;
}

/** The 30 prebuilt voice names available on Gemini Live. */
export const VOICE_NAMES: VoiceNameOption[] = [
  { id: "Aoede", label: "Aoede", hint: "Warm, professional. Default." },
  { id: "Puck", label: "Puck", hint: "Upbeat, conversational." },
  { id: "Charon", label: "Charon", hint: "Calm, measured." },
  { id: "Kore", label: "Kore", hint: "Bright, energetic." },
  { id: "Fenrir", label: "Fenrir", hint: "Deep, grounded." },
  { id: "Leda", label: "Leda" },
  { id: "Orus", label: "Orus" },
  { id: "Zephyr", label: "Zephyr" },
  { id: "Callirrhoe", label: "Callirrhoe" },
  { id: "Autonoe", label: "Autonoe" },
  { id: "Enceladus", label: "Enceladus" },
  { id: "Iapetus", label: "Iapetus" },
  { id: "Umbriel", label: "Umbriel" },
  { id: "Algieba", label: "Algieba" },
  { id: "Despina", label: "Despina" },
  { id: "Erinome", label: "Erinome" },
  { id: "Algenib", label: "Algenib" },
  { id: "Rasalgethi", label: "Rasalgethi" },
  { id: "Laomedeia", label: "Laomedeia" },
  { id: "Achernar", label: "Achernar" },
  { id: "Alnilam", label: "Alnilam" },
  { id: "Schedar", label: "Schedar" },
  { id: "Gacrux", label: "Gacrux" },
  { id: "Pulcherrima", label: "Pulcherrima" },
  { id: "Achird", label: "Achird" },
  { id: "Zubenelgenubi", label: "Zubenelgenubi" },
  { id: "Vindemiatrix", label: "Vindemiatrix" },
  { id: "Sadachbia", label: "Sadachbia" },
  { id: "Sadaltager", label: "Sadaltager" },
  { id: "Sulafat", label: "Sulafat" },
];
