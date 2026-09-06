import type { TelegramDeliverySummary } from "../../shared/contracts";
import { formatCount, formatIdentifierLabel } from "../lib/format";
import { DateTimeStamp } from "./DateTimeStamp";

function DeliveryTime({ delivery }: { delivery: TelegramDeliverySummary }) {
  if (delivery.sent_at !== null) return <DateTimeStamp value={delivery.sent_at} label="Delivered" />;
  if (delivery.status === "failed") return <span className="date-time-stamp__label">No More Retries</span>;
  return <DateTimeStamp value={delivery.next_attempt_at} label="Next Attempt" />;
}

export function AgentTelegramDeliveryLog({
  deliveries
}: {
  deliveries: TelegramDeliverySummary[];
}) {
  return (
    <section className="data-surface" aria-labelledby="agent-telegram-log-title">
      <div className="section-heading">
        <div>
          <h2 id="agent-telegram-log-title">Telegram Delivery Log</h2>
          <p>Queued alerts, successful deliveries, and stopped retries for this agent.</p>
        </div>
        <span className="numeric section-count">Total {formatCount(deliveries.length)}</span>
      </div>

      {deliveries.length === 0 ? (
        <p className="quiet-message">No Telegram messages have been queued for this agent.</p>
      ) : (
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
                    <span className={`telegram-delivery-state telegram-delivery-state--${delivery.status}`}>
                      {formatIdentifierLabel(delivery.status)}
                    </span>
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
