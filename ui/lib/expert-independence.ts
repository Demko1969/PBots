const synthesisRole = /^(?:eylem|aksiyon|uygulama) planlama uzmanı$|^(?:action|implementation) planning (?:expert|specialist)$/iu;
const peerWork = /(?:her(?:\s+bir)?|diğer|önceki|tüm|bütün|başka\s+bir|öteki)\s+(?:(?:bağımsız|görevli)\s+)?(?:uzman|ajan|agent)\p{L}*\s+(?:bulgu|sonuç|yanıt|cevap|çıktı|görüş|öneri|rapor|değerlendirme|çalışma)\p{L}*|(?:all|each|other|previous|fellow)\s+(?:agents?|experts?|specialists?)(?:[\u0027’]s?)?\s+(?:findings|outputs|answers|responses|recommendations|reports|assessments)|(?:uzman|ajan)\p{L}*\s+arasında\s+koordinasyon/iu;

export function isIndependentExpert(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("role" in value) || !("task" in value)) return false;
  const { role, task } = value;
  return typeof role === "string" && typeof task === "string" && !!role.trim() && !!task.trim()
    && !synthesisRole.test(role.trim()) && !peerWork.test(task);
}
