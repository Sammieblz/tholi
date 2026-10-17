import { PracticeWorkspace } from "./PracticeWorkspace";
import { usePracticeAdapter } from "./usePracticeAdapter";
export function Demo(props: Parameters<typeof usePracticeAdapter>[0]) {
  const adapter = usePracticeAdapter(props);
  return <PracticeWorkspace adapter={adapter} />;
}
