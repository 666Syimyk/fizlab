import { useId, useState } from "react";
import { CheckCircle2, Lightbulb, RotateCcw, XCircle } from "lucide-react";
import type { Problem } from "@/types/topic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MathText } from "@/components/MathText";
import { cn } from "@/lib/utils";
import { isSolved, markSolved } from "@/lib/progress";
import { logEvent } from "@/lib/analytics";
import { parseAnswer } from "./answer";

export function SelfCheckProblem({ problem, index, slug }: { problem: Problem; index: number; slug: string }) {
  const [value, setValue] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [status, setStatus] = useState<"idle" | "correct" | "wrong">(() =>
    isSolved(slug, problem.id) ? "correct" : "idle",
  );
  const [hintsShown, setHintsShown] = useState(0);
  const [solutionShown, setSolutionShown] = useState(false);
  const [inputError, setInputError] = useState(false);
  const errorId = useId();

  function checkAnswer() {
    const numeric = parseAnswer(value);
    setInputError(numeric === null);
    if (numeric === null) return;

    const allowedError = Math.abs(problem.answer) * (problem.tolerancePercent / 100);
    const isCorrect = Math.abs(numeric - problem.answer) <= allowedError;

    if (isCorrect) {
      setStatus("correct");
      const alreadySolved = isSolved(slug, problem.id);
      markSolved(slug, problem.id);
      if (!alreadySolved) logEvent("problem_solved", slug);
    } else {
      setStatus("wrong");
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 2) setSolutionShown(true);
    }
  }

  function reset() {
    setValue("");
    setAttempts(0);
    setStatus("idle");
    setHintsShown(0);
    setSolutionShown(false);
    setInputError(false);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
          Задача {index + 1}
          {status === "correct" && <CheckCircle2 className="h-4 w-4 text-success" />}
        </p>
        {status !== "idle" && (
          <button
            onClick={reset}
            className="flex items-center gap-1 text-xs text-muted-2 hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            сбросить
          </button>
        )}
      </div>

      <p className="mb-4 leading-relaxed text-foreground">
        <MathText text={problem.question} />
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(e) => { setValue(e.target.value); setInputError(false); }}
          onKeyDown={(e) => e.key === "Enter" && checkAnswer()}
          placeholder="Ваш ответ"
          className="max-w-[180px]"
          inputMode="decimal"
          aria-label={`Ответ на задачу ${index + 1}${problem.unit ? `, ${problem.unit}` : ""}`}
          aria-invalid={inputError}
          aria-describedby={inputError ? errorId : undefined}
        />
        {problem.unit && <span className="text-sm text-muted">{problem.unit}</span>}
        <Button variant="accent" size="sm" onClick={checkAnswer} disabled={!value}>
          Проверить
        </Button>
        {problem.hints.length > 0 && hintsShown < problem.hints.length && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHintsShown((h) => h + 1)}
          >
            <Lightbulb className="h-3.5 w-3.5" />
            Подсказка
          </Button>
        )}
      </div>

      {inputError && (
        <p id={errorId} role="alert" className="mt-3 text-sm text-danger">
          Введите число целиком, например 4,2 или 1.5e-3.
        </p>
      )}

      {status !== "idle" && (
        <div
          role="status"
          className={cn(
            "mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
            status === "correct"
              ? "bg-success/10 text-success"
              : "bg-danger/10 text-danger",
          )}
        >
          {status === "correct" ? (
            <>
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Верно! Допуск ±{problem.tolerancePercent}% учтён.
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 shrink-0" />
              Неверно (попытка {attempts}). {attempts < 2 ? "Попробуйте ещё раз." : "Решение показано ниже."}
            </>
          )}
        </div>
      )}

      {hintsShown > 0 && (
        <ul className="mt-4 space-y-1.5 border-l-2 border-accent/30 pl-3">
          {problem.hints.slice(0, hintsShown).map((hint, i) => (
            <li key={i} className="text-sm text-muted">
              <MathText text={hint} />
            </li>
          ))}
        </ul>
      )}

      {solutionShown && (
        <div className="mt-4 rounded-lg bg-surface-2 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">
            Решение
          </p>
          <ol className="space-y-1 text-sm text-muted">
            {problem.solution.map((step, i) => (
              <li key={i}>
                <MathText text={step} />
              </li>
            ))}
          </ol>
          {problem.note && (
            <p className="mt-3 rounded-lg bg-accent-2/10 px-3 py-2 text-xs leading-relaxed text-muted">
              <span className="font-semibold text-accent-2">Какие законы объединяет задача: </span>
              <MathText text={problem.note} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}
