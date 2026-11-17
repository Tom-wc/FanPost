import { splitCheck } from "../../shared/content-check";

export function TaskMessage({ message }: { message: string }) {
  const { text, check } = splitCheck(message);
  return (
    <>
      {text && <p className="failure-message">{text}</p>}
      {check && <p className={"check-line " + (check.ok ? "is-ok" : "is-warn")}>{check.text}</p>}
    </>
  );
}

export function CheckBadge({ message }: { message?: string }) {
  const check = message ? splitCheck(message).check : undefined;
  return check ? <p className={"check-line " + (check.ok ? "is-ok" : "is-warn")}>{check.text}</p> : null;
}
