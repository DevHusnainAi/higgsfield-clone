import { PromptComposer } from "@/components/prompt-composer";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
        What are you making?
      </h1>
      <PromptComposer />
    </div>
  );
}
