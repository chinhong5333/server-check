import type { TelegramDeliverySummary } from "../../shared/contracts";
import { formatCount, formatIdentifierLabel } from "../lib/format";
import { DateTimeStamp } from "./DateTimeStamp";
import { CancelPendingTelegram } from "./CancelPendingTelegram";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { t } from "../i18n";

function DeliveryBadge({ status }: { status: TelegramDeliverySummary["status"] }) {
  return <span className={`telegram-delivery-state telegram-delivery-state--${status}`}>{formatIdentifierLabel(status)}</span>;
}

function MobileDeliveryList({ deliveries }: { deliveries: TelegramDeliverySummary[] }) {
  return <ol className="mobile-delivery-list" aria-label={t("Telegram Deliveries")}>
    {deliveries.map((delivery) => <li key={delivery.id} className="mobile-delivery">
      <div className="mobile-delivery__top">
        <div className="mobile-delivery__meta"><span className="mono-label">{delivery.event_type === "opened" ? t("Alert") : t("Recovery")}</span>
          <span>{formatCount(delivery.attempt_count)} {delivery.attempt_count === 1 ? t("Attempt") : t("Attempts")}</span></div>
        <DeliveryBadge status={delivery.status} />
      </div>
      <div className="mobile-delivery__incident"><h3>{formatIdentifierLabel(delivery.incident_type)}</h3>
        <p>{t(delivery.probable_cause)}</p></div>
      {delivery.last_error && <p className="mobile-delivery__error">{t(delivery.last_error)}</p>}
      <div className="mobile-delivery__timing"><DateTimeStamp value={delivery.queued_at} label={t("Queued At")} />
        <DeliveryTime delivery={delivery} /></div>
    </li>)}
  </ol>;
}

function DeliveryTime({ delivery }: { delivery: TelegramDeliverySummary }) {
  if (delivery.sent_at !== null) return <DateTimeStamp value={delivery.sent_at} label={t("Delivered")} />;
  if (delivery.status === "failed") return <span className="date-time-stamp__label">{t("No More Retries")}</span>;
  if (delivery.status === "cancelled") return <span className="date-time-stamp__label">{t("Cancelled")}</span>;
  return <DateTimeStamp value={delivery.next_attempt_at} label={t("Next Attempt")} />;
}

export function AgentTelegramDeliveryLog({
  deliveries,
  cancellation
}: {
  deliveries: TelegramDeliverySummary[];
  cancellation?: { agentId: string; agentName: string; onCancelled: () => void };
}) {
  const mobile = useMediaQuery("(max-width: 59.999rem)");
  return (
    <section className="data-surface" aria-labelledby="agent-telegram-log-title">
      <div className="section-heading telegram-log-heading">
        <div>
          <h2 id="agent-telegram-log-title">{t("Telegram Delivery Log")}</h2>
          <p>{t("Queued alerts, successful deliveries, and stopped retries for this agent.")}</p>
        </div>
        <div className="telegram-log-actions"><span className="numeric section-count">{t("Total {0}", formatCount(deliveries.length))}</span>
        {cancellation && <CancelPendingTelegram {...cancellation} />}
        </div>
      </div>

      {deliveries.length === 0 ? (
        <p className="quiet-message">{t("No Telegram messages have been queued for this agent.")}</p>
      ) : mobile ? <MobileDeliveryList deliveries={deliveries} /> : (
        <div className="table-wrap">
          <table className="data-table telegram-delivery-table">
            <thead>
              <tr>
                <th scope="col">{t("Event")}</th>
                <th scope="col">{t("Incident")}</th>
                <th scope="col">{t("Delivery")}</th>
                <th scope="col">{t("Attempts")}</th>
                <th scope="col">{t("Queued At")}</th>
                <th scope="col">{t("Delivered / Next Attempt")}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <th scope="row" data-label={t("Event")} className="mono-label">
                    {delivery.event_type === "opened" ? t("Alert") : t("Recovery")}
                  </th>
                  <td data-label={t("Incident")}>
                    <strong>{formatIdentifierLabel(delivery.incident_type)}</strong>
                    <small className="delivery-detail">{t(delivery.probable_cause)}</small>
                  </td>
                  <td data-label={t("Delivery")}>
                    <DeliveryBadge status={delivery.status} />
                    {delivery.last_error ? <small className="delivery-detail delivery-detail--error">{t(delivery.last_error)}</small> : null}
                  </td>
                  <td data-label={t("Attempts")} className="numeric">{formatCount(delivery.attempt_count)}</td>
                  <td data-label={t("Queued At")} className="numeric"><DateTimeStamp value={delivery.queued_at} /></td>
                  <td data-label={t("Delivered / Next Attempt")} className="numeric"><DeliveryTime delivery={delivery} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
