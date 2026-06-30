import { useCallback, useEffect, useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import Spinner from "../components/Spinner";
import { nutritionAdvice, estimateNutrition } from "../lib/api";

interface Entry {
  id: string;
  entry_date: string;
  meal: string | null;
  label: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

const MEALS = ["Petit-déjeuner", "Déjeuner", "Dîner", "Collation"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Nutrition() {
  const { session } = useAuth();
  const [date, setDate] = useState(todayIso());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Formulaire
  const [meal, setMeal] = useState(MEALS[0]);
  const [label, setLabel] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);

  // Conseils IA
  const [advice, setAdvice] = useState<string | null>(null);
  const [adviceBusy, setAdviceBusy] = useState(false);

  const load = useCallback(async (d: string) => {
    const { data, error: e } = await supabase
      .from("nutrition_entries")
      .select("id, entry_date, meal, label, calories, protein_g, carbs_g, fat_g")
      .eq("entry_date", d)
      .order("created_at", { ascending: true });
    if (e) setError(e.message);
    setEntries(data ?? []);
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  async function addEntry(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !session) return;
    setSaving(true);
    setError(null);
    try {
      const { error: e2 } = await supabase.from("nutrition_entries").insert({
        user_id: session.user.id,
        entry_date: date,
        meal,
        label: label.trim(),
        calories: calories ? Number(calories) : null,
        protein_g: protein ? Number(protein) : null,
        carbs_g: carbs ? Number(carbs) : null,
        fat_g: fat ? Number(fat) : null,
      });
      if (e2) throw new Error(e2.message);
      setLabel("");
      setCalories("");
      setProtein("");
      setCarbs("");
      setFat("");
      await load(date);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setEntries((es) => es.filter((x) => x.id !== id));
    await supabase.from("nutrition_entries").delete().eq("id", id);
  }

  // Estime calories/macros à partir de la description du repas (IA), puis
  // pré-remplit les champs (l'utilisateur peut corriger avant d'ajouter).
  async function estimate() {
    const desc = label.trim();
    if (!desc || estimating) return;
    setEstimating(true);
    setError(null);
    try {
      const r = await estimateNutrition(desc);
      if (r.label) setLabel(r.label);
      setCalories(String(r.calories));
      setProtein(String(r.protein_g));
      setCarbs(String(r.carbs_g));
      setFat(String(r.fat_g));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEstimating(false);
    }
  }

  async function getAdvice() {
    setAdviceBusy(true);
    setError(null);
    try {
      const res = await nutritionAdvice(7);
      setAdvice(res.content_md);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdviceBusy(false);
    }
  }

  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + (e.calories ?? 0),
      p: acc.p + (e.protein_g ?? 0),
      c: acc.c + (e.carbs_g ?? 0),
      f: acc.f + (e.fat_g ?? 0),
    }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );

  const byMeal = MEALS.map((m) => ({ meal: m, items: entries.filter((e) => e.meal === m) })).filter(
    (g) => g.items.length > 0,
  );

  const inputCls =
    "mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";
  const btnCls =
    "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";

  return (
    <Layout>
      <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Nutrition
          </h1>
          <input
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Totaux du jour */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Total label="Calories" value={`${Math.round(totals.kcal)} kcal`} />
          <Total label="Protéines" value={`${Math.round(totals.p)} g`} />
          <Total label="Glucides" value={`${Math.round(totals.c)} g`} />
          <Total label="Lipides" value={`${Math.round(totals.f)} g`} />
        </section>

        {/* Ajout d'un repas */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="font-medium text-neutral-900 dark:text-neutral-100">Ajouter un aliment</h2>
          <form onSubmit={addEntry} className="mt-4 grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium">Repas</label>
              <select className={inputCls} value={meal} onChange={(e) => setMeal(e.target.value)}>
                {MEALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-4">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">Aliment *</label>
                <button
                  type="button"
                  onClick={estimate}
                  disabled={estimating || !label.trim()}
                  className="inline-flex items-center gap-1 text-xs text-neutral-600 transition hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-300 dark:hover:text-neutral-100"
                  title="Estimer calories et macros à partir de la description"
                >
                  {estimating ? <Spinner /> : <ion-icon name="sparkles-outline"></ion-icon>}
                  Estimer les valeurs (IA)
                </button>
              </div>
              <input required placeholder="ex. Riz complet + poulet, 2 œufs…" value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium">kcal</label>
              <input type="number" value={calories} onChange={(e) => setCalories(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium">Prot. (g)</label>
              <input type="number" value={protein} onChange={(e) => setProtein(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium">Gluc. (g)</label>
              <input type="number" value={carbs} onChange={(e) => setCarbs(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium">Lip. (g)</label>
              <input type="number" value={fat} onChange={(e) => setFat(e.target.value)} className={inputCls} />
            </div>
            <div className="sm:col-span-2 flex items-end">
              <button type="submit" disabled={saving} className={btnCls}>
                {saving ? <Spinner /> : "Ajouter"}
              </button>
            </div>
          </form>
        </section>

        {/* Liste par repas */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="font-medium text-neutral-900 dark:text-neutral-100">Journal du jour</h2>
          {byMeal.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Aucun aliment enregistré pour cette date.</p>
          ) : (
            <div className="mt-3 space-y-4">
              {byMeal.map((g) => (
                <div key={g.meal}>
                  <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{g.meal}</h3>
                  <ul className="mt-1 divide-y divide-neutral-100 dark:divide-neutral-800">
                    {g.items.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{e.label}</span>
                        <span className="shrink-0 text-neutral-500">
                          {[
                            e.calories ? `${e.calories} kcal` : "",
                            e.protein_g ? `${e.protein_g}P` : "",
                            e.carbs_g ? `${e.carbs_g}G` : "",
                            e.fat_g ? `${e.fat_g}L` : "",
                          ].filter(Boolean).join(" · ")}
                        </span>
                        <button
                          onClick={() => remove(e.id)}
                          aria-label="Supprimer"
                          className="shrink-0 text-neutral-400 hover:text-red-600"
                        >
                          <ion-icon name="trash-outline"></ion-icon>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Conseils IA */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
              <ion-icon name="nutrition-outline" className="text-base"></ion-icon>
              Conseils nutrition (IA)
            </h2>
            <button onClick={getAdvice} disabled={adviceBusy} className={btnCls}>
              {adviceBusy ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Analyse…
                </span>
              ) : advice ? (
                "Régénérer"
              ) : (
                "Obtenir des conseils"
              )}
            </button>
          </div>
          <div className="mt-4">
            {adviceBusy ? (
              <p className="flex items-center gap-2 text-sm text-neutral-500">
                <Spinner /> Le coach croise ton alimentation et ta charge…
              </p>
            ) : advice ? (
              <div className="markdown text-neutral-700 dark:text-neutral-300">
                <Markdown>{advice}</Markdown>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                Enregistre tes repas sur quelques jours, puis demande des conseils croisés avec ta charge d'entraînement.
              </p>
            )}
          </div>
        </section>
      </main>
    </Layout>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
    </div>
  );
}
