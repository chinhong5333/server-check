import type { TelegramDeliverySummary } from "../../shared/contracts";
import { formatCount, formatIdentifierLabel } from "../lib/format";
import { DateTimeStamp } from "./DateTimeStamp";
import { CancelPendingTelegram } from "./CancelPendingTelegram";
import { useMediaQuery } from "../hooks/useMediaQuery";

function DeliveryBadge({ status }: { status: TelegramDeliverySummary["status"] }) {
  return <span className={`telegram-delivery-state telegram-delivery-state--${status}`}>{formatIdentifierLabel(status)}</span>;
}

function MobileDeliveryList({ deliveries }: { deliveries: TelegramDeliverySummary[] }) {
  return <ol className="mobile-delivery-list" aria-label="Telegram Deliveries">
    {deliveries.map((delivery) => <li key={delivery.id} className="mobile-delivery">
      <div className="mobile-delivery__top">
        <div className="mobile-delivery__meta"><span className="mono-label">{delivery.event_type === "opened" ? "Alert" : "Recovery"}</span>
          <span>{formatCount(delivery.attempt_count)} {delivery.attempt_count === 1 ? "Attempt" : "Attempts"}</span></div>
        <DeliveryBadge status={delivery.status} />
      </div>
      <div className="mobile-delivery__incident"><h3>{formatIdentifierLabel(delivery.incident_type)}</h3>
        <p>{delivery.probable_cause}</p></div>
      {delivery.last_error && <p className="mobile-delivery__error">{delivery.last_error}</p>}
      <div className="mobile-delivery__timing"><DateTimeStamp value={delivery.queued_at} label="Queued At" />
        <DeliveryTime delivery={delivery} /></div>
    </li>)}
  </ol>;
}

function DeliveryTime({ delivery }: { delivery: TelegramDeliverySummary }) {
  if (delivery.sent_at !== null) return <DateTimeStamp value={delivery.sent_at} label="Delivered" />;
  if (delivery.status === "failed") return <span className="date-time-stamp__label">No More Retries</span>;
  if (delivery.status === "cancelled") return <span className="date-time-stamp__label">Cancelled</span>;
  return <DateTimeStamp value={delivery.next_attempt_at} label="Next Attempt" />;
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
          <h2 id="agent-telegram-log-title">Telegram Delivery Log</h2>
          <p>Queued alerts, successful deliveries, and stopped retries for this agent.</p>
        </div>
        <div className="telegram-log-actions"><span className="numeric section-count">Total {formatCount(deliveries.length)}</span>
        {cancellation && <CancelPendingTelegram {...cancellation} />}
        </div>
      </div>

      {deliveries.length === 0 ? (
        <p className="quiet-message">No Telegram messages have been queued for this agent.</p>
      ) : mobile ? <MobileDeliveryList deliveries={deliveries} /> : (
        <div className="table-wrap">
          <table className="data-table telegram-delivery-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Incident</th>
                <th scope="col">Delivery</th>
                <th scope="col">Attempts</th>
                <th scope="col">Queued At</th>
                <th scope="col">Delivered / Next Attempt</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <th scope="row" data-label="Event" className="mono-label">
                    {delivery.event_type === "opened" ? "Alert" : "Recovery"}
                  </th>
                  <td data-label="Incident">
                    <strong>{formatIdentifierLabel(delivery.incident_type)}</strong>
                    <small className="delivery-detail">{delivery.probable_cause}</small>
                  </td>
                  <td data-label="Delivery">
                    <DeliveryBadge status={delivery.status} />
                    {delivery.last_error ? <small className="delivery-detail delivery-detail--error">{delivery.last_error}</small> : null}
                  </td>
                  <td data-label="Attempts" className="numeric">{formatCount(delivery.attempt_count)}</td>
                  <td data-label="Queued At" className="numeric"><DateTimeStamp value={delivery.queued_at} /></td>
                  <td data-label="Delivered / Next Attempt" className="numeric"><DeliveryTime delivery={delivery} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
