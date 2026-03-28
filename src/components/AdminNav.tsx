import Link from "next/link";

type Props = {
  current: "courses" | "sessions";
};

export default function AdminNav({ current }: Props) {
  const base = "rounded-lg px-3 py-2 text-sm font-medium transition";
  const active = "bg-zinc-900 text-white";
  const inactive =
    "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50";

  return (
    <div className="mb-6 flex items-center gap-2">
      <Link
        href="/courses"
        className={`${base} ${current === "courses" ? active : inactive}`}
      >
        Courses
      </Link>
      <Link
        href="/sessions"
        className={`${base} ${current === "sessions" ? active : inactive}`}
      >
        Sessions
      </Link>
    </div>
  );
}