import React, { useState, useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Building2, Target, Users, MapPin, DollarSign, Calendar,
  CheckCircle2, Tag, ChevronRight, ChevronLeft, X, Plus, Check
} from "lucide-react";
import type { OrgProfileData } from "@/context/AuthContext";

const ORG_TYPES = [
  { value: "nonprofit", label: "Nonprofit", emoji: "🤝", desc: "501(c)(3) or similar" },
  { value: "small_business", label: "Small Business", emoji: "🏪", desc: "For-profit, small enterprise" },
  { value: "university", label: "University / Research", emoji: "🎓", desc: "Academic institution" },
  { value: "government", label: "Government", emoji: "🏛️", desc: "Public sector entity" },
  { value: "individual", label: "Individual", emoji: "👤", desc: "Solo applicant" },
  { value: "other", label: "Other", emoji: "🔷", desc: "Other organization type" },
];

const BUDGET_OPTIONS = [
  { label: "Under $100K", value: 75000 },
  { label: "$100K–$500K", value: 300000 },
  { label: "$500K–$1M", value: 750000 },
  { label: "$1M–$5M", value: 2500000 },
  { label: "$5M–$10M", value: 7500000 },
  { label: "Over $10M", value: 15000000 },
];

const PROGRAM_SUGGESTIONS = [
  "education", "workforce development", "health & wellness", "mental health",
  "housing", "food security", "arts & culture", "environment", "youth services",
  "economic development", "justice & equity", "immigration", "senior services",
  "disability services", "technology & innovation", "research", "public safety",
];

const POPULATION_SUGGESTIONS = [
  "low-income individuals", "youth (under 18)", "young adults (18–30)",
  "seniors (65+)", "women", "veterans", "immigrants & refugees",
  "rural communities", "people experiencing homelessness", "people with disabilities",
  "LGBTQ+ individuals", "Black & African American", "Hispanic & Latino",
  "Indigenous communities", "general public",
];

const GEO_SUGGESTIONS = [
  "United States", "California", "New York", "Texas", "Illinois", "Florida",
  "Michigan", "Ohio", "Pennsylvania", "Georgia", "North Carolina",
  "National", "International",
];

const KEYWORD_SUGGESTIONS = [
  "mentorship", "job training", "capacity building", "community outreach",
  "after-school programs", "STEM", "literacy", "financial literacy",
  "affordable housing", "food pantry", "case management", "advocacy",
  "research & evaluation", "direct service", "grant management",
];

function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeTag = (tag: string) => onChange(value.filter((t) => t !== tag));

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && input.trim()) {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s.toLowerCase())
  ).slice(0, 6);

  return (
    <div className="space-y-2">
      <div
        className="min-h-[44px] border border-input rounded-lg px-3 py-2 flex flex-wrap gap-1.5 cursor-text focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0 bg-background"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">
            {tag}
            <button type="button" onClick={(e) => { e.stopPropagation(); removeTag(tag); }} className="hover:text-primary/60 transition-colors">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); }}
          onKeyDown={handleKey}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={value.length === 0 ? placeholder : "Add more…"}
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="border border-border rounded-lg bg-background shadow-lg overflow-hidden z-10">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={() => addTag(s)}
              className="w-full text-left text-xs px-3 py-2 hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground">+ </span>{s}
            </button>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions
            .filter((s) => !value.includes(s.toLowerCase()))
            .slice(0, 8)
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addTag(s)}
                className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary transition-all"
              >
                + {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function YesNo({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex gap-3">
      {[{ label: "Yes", val: true }, { label: "No", val: false }].map(({ label, val }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(val)}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-medium transition-all ${value === val ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-border/80"}`}
        >
          {value === val && <Check className="h-4 w-4" />}
          {label}
        </button>
      ))}
    </div>
  );
}

const STEPS = [
  { id: "identity", label: "Your Organization", icon: Building2 },
  { id: "mission", label: "Mission", icon: Target },
  { id: "programs", label: "Programs & People", icon: Users },
  { id: "geography", label: "Where You Work", icon: MapPin },
  { id: "details", label: "Organization Details", icon: DollarSign },
  { id: "keywords", label: "Grant Keywords", icon: Tag },
];

interface OrgProfileFormProps {
  initial?: Partial<OrgProfileData> | null;
  onSave: (profile: OrgProfileData) => Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
  saveLabel?: string;
}

export function OrgProfileForm({ initial, onSave, onCancel, saving, saveLabel = "Save Profile" }: OrgProfileFormProps) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  const [name, setName] = useState(initial?.name ?? "");
  const [orgType, setOrgType] = useState(initial?.org_type ?? "nonprofit");
  const [mission, setMission] = useState(initial?.mission ?? "");
  const [programAreas, setProgramAreas] = useState<string[]>(initial?.program_areas ?? []);
  const [populationServed, setPopulationServed] = useState<string[]>(initial?.population_served ?? []);
  const [geography, setGeography] = useState<string[]>(initial?.geography ?? []);
  const [budgetIndex, setBudgetIndex] = useState(() => {
    if (!initial?.annual_budget) return -1;
    return BUDGET_OPTIONS.findIndex((b) => b.value === initial.annual_budget) ?? -1;
  });
  const [customBudget, setCustomBudget] = useState(
    initial?.annual_budget && BUDGET_OPTIONS.findIndex((b) => b.value === initial.annual_budget) === -1
      ? String(initial.annual_budget)
      : ""
  );
  const [years, setYears] = useState(initial?.years_in_operation ?? 1);
  const [has501c3, setHas501c3] = useState(initial?.has_501c3 ?? false);
  const [isSmallBiz, setIsSmallBiz] = useState(initial?.is_small_business ?? false);
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords ?? []);

  function validateStep(idx: number): string {
    if (idx === 0 && !name.trim()) return "Please enter your organization name.";
    if (idx === 1 && !mission.trim()) return "Please describe your mission.";
    if (idx === 2 && programAreas.length === 0) return "Please add at least one program area.";
    if (idx === 3 && geography.length === 0) return "Please add at least one geographic area.";
    return "";
  }

  function nextStep() {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError("");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function prevStep() {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit() {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    if (keywords.length === 0) { setError("Please add at least one keyword to help match grants."); return; }
    setError("");

    const budget = budgetIndex >= 0
      ? BUDGET_OPTIONS[budgetIndex].value
      : (Number(customBudget) || 0);

    const profile: OrgProfileData = {
      id: name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      name: name.trim(),
      org_type: orgType as OrgProfileData["org_type"],
      mission: mission.trim(),
      program_areas: programAreas,
      population_served: populationServed,
      geography,
      annual_budget: budget,
      years_in_operation: years,
      has_501c3: has501c3,
      is_small_business: isSmallBiz,
      keywords,
    };
    await onSave(profile);
  }

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{STEPS[step].label}</span>
          <span>Step {step + 1} of {STEPS.length}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex gap-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.id}
                className={`flex-1 flex items-center justify-center py-1 rounded text-[9px] gap-0.5 font-medium transition-all ${i === step ? "bg-primary/10 text-primary" : i < step ? "text-primary/60" : "text-muted-foreground/40"}`}
              >
                <Icon className="h-2.5 w-2.5" />
                <span className="hidden sm:inline truncate">{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-[280px]">

        {/* Step 0 — Identity */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground">What is your organization's name?</h2>
              <p className="text-sm text-muted-foreground mt-1">This is how you'll appear in grant matches.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-name" className="text-xs font-medium">Organization name</Label>
              <Input
                id="org-name"
                placeholder="e.g. Community Impact Initiative"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-sm"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs font-medium mb-3 block">What type of organization are you?</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ORG_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setOrgType(t.value)}
                    className={`flex flex-col items-start gap-1 p-3 rounded-xl border-2 text-left transition-all ${orgType === t.value ? "border-primary bg-primary/10" : "border-border hover:border-border/80"}`}
                  >
                    <span className="text-xl">{t.emoji}</span>
                    <span className="text-xs font-semibold text-foreground">{t.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 1 — Mission */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground">What is your organization's mission?</h2>
              <p className="text-sm text-muted-foreground mt-1">Describe your core purpose and the change you're working toward. This is the most important signal for matching grants.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mission" className="text-xs font-medium">Mission statement</Label>
              <Textarea
                id="mission"
                placeholder="e.g. We empower underserved youth through education, mentorship, and workforce training programs that create pathways to economic opportunity."
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                className="text-sm min-h-[140px] resize-none"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground text-right">{mission.length} characters</p>
            </div>
          </div>
        )}

        {/* Step 2 — Programs & People */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground">Programs & People</h2>
              <p className="text-sm text-muted-foreground mt-1">Tell us what you do and who you serve.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">What are your primary program areas?</Label>
              <p className="text-[11px] text-muted-foreground">Type and press Enter, or click suggestions below.</p>
              <TagInput
                value={programAreas}
                onChange={setProgramAreas}
                placeholder="e.g. education, workforce development…"
                suggestions={PROGRAM_SUGGESTIONS}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Who does your organization primarily serve?</Label>
              <p className="text-[11px] text-muted-foreground">Add the populations you work with.</p>
              <TagInput
                value={populationServed}
                onChange={setPopulationServed}
                placeholder="e.g. low-income youth, veterans…"
                suggestions={POPULATION_SUGGESTIONS}
              />
            </div>
          </div>
        )}

        {/* Step 3 — Geography */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground">Where does your organization work?</h2>
              <p className="text-sm text-muted-foreground mt-1">Add countries, states, cities, or regions where you operate or seek funding.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Geographic areas</Label>
              <TagInput
                value={geography}
                onChange={setGeography}
                placeholder="e.g. California, Chicago, United States…"
                suggestions={GEO_SUGGESTIONS}
              />
            </div>
          </div>
        )}

        {/* Step 4 — Details */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground">Tell us about your organization's scale</h2>
              <p className="text-sm text-muted-foreground mt-1">These details help filter for grants suited to your capacity.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">What is your approximate annual budget?</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {BUDGET_OPTIONS.map((b, i) => (
                  <button
                    key={b.label}
                    type="button"
                    onClick={() => { setBudgetIndex(i); setCustomBudget(""); }}
                    className={`py-2.5 px-3 rounded-xl border-2 text-xs font-medium transition-all text-center ${budgetIndex === i && !customBudget ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-border/80"}`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground">Or enter exact amount: $</span>
                <Input
                  type="number"
                  placeholder="e.g. 450000"
                  value={customBudget}
                  onChange={(e) => { setCustomBudget(e.target.value); setBudgetIndex(-1); }}
                  className="h-8 text-xs w-36"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">How many years has your organization been operating?</Label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setYears((y) => Math.max(0, y - 1))} className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-lg text-muted-foreground hover:text-foreground transition-colors">−</button>
                <span className="text-2xl font-bold text-foreground w-12 text-center">{years}</span>
                <button type="button" onClick={() => setYears((y) => y + 1)} className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-lg text-muted-foreground hover:text-foreground transition-colors">+</button>
                <span className="text-sm text-muted-foreground">{years === 1 ? "year" : "years"}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Does your organization have 501(c)(3) status?</Label>
                <YesNo value={has501c3} onChange={setHas501c3} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Is your organization a small business?</Label>
                <YesNo value={isSmallBiz} onChange={setIsSmallBiz} />
              </div>
            </div>
          </div>
        )}

        {/* Step 5 — Keywords */}
        {step === 5 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-foreground">What keywords describe your work?</h2>
              <p className="text-sm text-muted-foreground mt-1">These are used by the V3 algorithm to find highly specific grant matches. Add terms that appear in grants you'd typically apply for.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Keywords & phrases</Label>
              <TagInput
                value={keywords}
                onChange={setKeywords}
                placeholder="e.g. job training, mentorship, STEM…"
                suggestions={KEYWORD_SUGGESTIONS}
              />
            </div>
            {keywords.length > 0 && (
              <div className="bg-muted/30 border border-border/40 rounded-xl px-4 py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Profile preview</p>
                <p><span className="text-foreground">{name}</span> · {ORG_TYPES.find(t => t.value === orgType)?.label}</p>
                <p className="mt-0.5 line-clamp-2 italic">{mission}</p>
                <p className="mt-0.5">Areas: {programAreas.slice(0, 3).join(", ")}{programAreas.length > 3 ? ` +${programAreas.length - 3} more` : ""}</p>
                <p>Regions: {geography.join(", ")}</p>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          <X className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-3">
        {step > 0 && (
          <Button type="button" variant="outline" onClick={prevStep} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
        )}
        {onCancel && step === 0 && (
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        )}
        <div className="flex-1" />
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={nextStep} className="gap-1.5">
            Continue <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" onClick={handleSubmit} disabled={saving} className="gap-1.5">
            {saving ? "Saving…" : <><CheckCircle2 className="h-4 w-4" /> {saveLabel}</>}
          </Button>
        )}
      </div>
    </div>
  );
}
