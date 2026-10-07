// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentForm } from "../../src/client/components/AgentForm";
import { ToastProvider } from "../../src/client/components/ToastProvider";
import { updateAgentBodySchema } from "../../src/shared/contracts";

afterEach(cleanup);
it("keeps issue settings and submits the independent recovery interval with canonical input names", () => {
  const submit = vi.fn();
  render(<ToastProvider><AgentForm initialValues={{ server_name: "synthetic-agent", telegram_alert_cooldown_seconds: 3600 }} submitting={false} error={null} submitLabel="Save Changes" submittingLabel="Saving" onSubmit={submit}/></ToastProvider>);
  expect(screen.getByLabelText("Issue Alert Interval")).toHaveValue("3600");
  expect(screen.getByLabelText("Recovery Interval")).toHaveValue("30");
  fireEvent.change(screen.getByLabelText("Recovery Interval"), { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0][0]).toMatchObject({ telegram_alert_cooldown_seconds: 3600, telegram_recovery_cooldown_seconds: 60 });
  const legacy = { ...submit.mock.calls[0][0] }; delete legacy.telegram_recovery_cooldown_seconds;
  expect(updateAgentBodySchema.parse(legacy)).not.toHaveProperty("telegram_recovery_cooldown_seconds");
});
