// Ambient declaration — wink-naive-bayes-text-classifier ships no .d.ts.
// Documented surface: https://winkjs.org/wink-naive-bayes-text-classifier/
declare module 'wink-naive-bayes-text-classifier' {
  type Tokens = readonly string[];
  type PrepTask = (text: string) => Tokens | string;
  interface Classifier {
    definePrepTasks(tasks: readonly PrepTask[]): void;
    defineConfig(opts: { considerOnlyPresence?: boolean; smoothingFactor?: number }): void;
    learn(input: string, label: string): void;
    consolidate(): void;
    predict(input: string): string;
    computeOdds(input: string): ReadonlyArray<readonly [string, number]>;
    exportJSON(): string;
    importJSON(json: string): void;
    stats(): { labelCount: number; samples: number };
    reset(): void;
  }
  const winkBayes: () => Classifier;
  export default winkBayes;
}
