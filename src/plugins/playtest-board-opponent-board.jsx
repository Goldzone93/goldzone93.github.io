// /src/plugins/playtest-board-opponent-board.jsx
import React from 'react';
import { CardZoom } from './card-zoom.jsx';

/**
 * Interactive opponent board
 * - Uses its own slot keys, prefixed with "o" (ou1..ou7, os1..os7, ob1, opartner, oshield, obanish, odeck, ograve)
 * - Accepts the same DnD handlers as the player board
 * - Renders the placed card image if the slot has a card in boardSlots
 */
export function OpponentBoard({
    boardSlots = {},
    slotSides = {},
    exhaustedSlots = new Set(),
    hoverSlot = null,

    // NEW: opponent piles for visual parity
    oDeckPile = [],
    oShieldPile = [],
    oBanishPile = [],
    oGravePile = [],

    // DnD handlers provided by the main board hook
    onSlotDragOver,
    onSlotDragLeave,
    onSlotDrop,
    onSlotCardDragStart,
    onSlotCardDragEnd,

    // NEW: opponent stack drop handlers
    onOShieldDragOver,
    onOShieldDrop,
    onOBanishDragOver,
    onOBanishDrop,
    onOGraveDragOver,
    onOGraveDrop,
    onODeckDragOver,
    onODeckDrop,

    // NEW: drag starts for top of opponent stacks
    onOShieldDragStart,
    onOBanishDragStart,
    onOGraveDragStart,
    onODeckDragStart,

    // ADD in the OpponentBoard parameter list (keep existing props):
    oHand,
    onOHandDragStart,
    onOHandDragEnd,
    onOHandContainerDragOver,
    onOHandContainerDrop,
    onOHandItemDragOver,
    onOHandItemDrop,

    // NEW: counters + labels on opponent cards
    slotCounters,
    slotLabels,
    slotResources,
    renderCounterBadges,
    renderLabelBadges,
    renderResourceBadges,
    renderUnitStats,

    // click handler for placement mode
    onOpponentSlotClick,

    // NEW: role flags for opponent battle slots
    battleRole,

}) {
    const U = [1, 2, 3, 4, 5, 6, 7];
    const S = U;

    // local helper to build a card image url; always honor the requested face
    const imgSrc = (id, side = 'a') => {
        const base = String(id || '').replace(/_(a|b)$/i, '');
        return `/images/${base}_${side}.png`;
    };
    const onImgError = (e, side = 'a') => {
        e.currentTarget.onerror = null;
        e.currentTarget.src = side === 'b' ? '/images/card0000_b.png' : '/images/card0000_a.png';
    };
    // Ensure we pass "<id>_a" to CardZoom for the front face
    const ensureFrontId = (id) => `${String(id || '').replace(/_(a|b)$/i, '')}_a`;

    const Slot = ({ k, className = 'pb-slot pb-rot', name, style: styleIn }) => {
        const cardId = boardSlots[k];
        const side = (slotSides && slotSides[k]) || 'a';
        const isExhausted = exhaustedSlots?.has?.(k);
        const isHover = hoverSlot === k;
        const hoardsTotal = (obj) =>
            Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);
        return (
            <div
                className={className}
                data-name={name}
                data-slot={k}
                onClick={onOpponentSlotClick && onOpponentSlotClick(k)}
                onDragOver={onSlotDragOver && onSlotDragOver(k)}
                onDragLeave={onSlotDragLeave}
                onDrop={onSlotDrop && onSlotDrop(k)}
                style={{
                    ...(styleIn || {}),
                    ...(isHover ? { outline: '1px solid rgba(92,134,255,0.6)' } : {}),
                }}
                aria-label={name}
                role="gridcell"
            >
                {cardId ? (
                    <div className={`pb-slot-card${isExhausted ? ' is-exhausted' : ''}`}
                        data-hoards-total={hoardsTotal(slotResources?.[k])}
                    >
                        <div className="pb-card-frame">
                            <CardZoom id={ensureFrontId(cardId)} name={cardId} />
                            <img
                                className="pb-card-img"
                                src={imgSrc(cardId, side)}
                                alt={`opponent:${cardId}:${side}`}
                                draggable
                                onDragStart={onSlotCardDragStart && onSlotCardDragStart(k)}
                                onDragEnd={onSlotCardDragEnd}
                                onError={(e) => onImgError(e, side)}
                                data-menu-area="slot-card"
                                data-card-id={cardId}
                                data-slot-key={k}
                                data-side={side}
                            />
                            {renderCounterBadges?.(slotCounters?.[k])}
                            {renderLabelBadges?.(slotLabels?.[k])}
                            {renderResourceBadges?.(slotResources?.[k])}
                            {/^(?:ou|ob)\d+$/.test(k) && renderUnitStats?.(k, cardId)}
                            {/* Battle role badges on opponent battle slots */}
                            {/^ob\d+$/.test(k) && battleRole?.[k] === 'attacker' && (
                                <div className="pb-battle-badge attacker">ATTACKER</div>
                            )}
                            {/^ob\d+$/.test(k) && battleRole?.[k] === 'blocker' && (
                                <div className="pb-battle-badge blocker">BLOCKER</div>
                            )}
                        </div>
                    </div>
                ) : null}
            </div>
        );
    };

    return (
        <div className="pb-opponent-wrap">
            <div className="pb-opponent-title">Opponent</div>
            {/* Opponent Hand — fixed row under the label */}
            <div
                className="pb-opponent-hand pb-hand"
                data-name="Opponent Hand"
                role="region"
                aria-label="Opponent Hand"
                onDragOver={onOHandContainerDragOver}
                onDrop={onOHandContainerDrop}
            >
                <div className="pb-hand-cards">
                    {Array.isArray(oHand) && oHand.map((id, idx) => (
                        <div
                            key={`${id}:${idx}`}
                            className="pb-hand-item"
                            draggable
                            onDragStart={(e) => onOHandDragStart(idx)(e)}
                            onDragEnd={onOHandDragEnd}
                            onDragOver={onOHandItemDragOver}
                            onDrop={onOHandItemDrop(idx)}
                            title={id}
                            data-menu-area="hand-card"
                            data-owner="opponent"
                            data-card-id={id}
                            data-index={idx}
                            data-side={/_b$/i.test(String(id)) ? 'b' : 'a'}
                        >
                            <div className="pb-card-frame">
                                <CardZoom id={ensureFrontId(id)} name={id} />
                                <img
                                    className="pb-card-img"
                                    src={imgSrc(id, /_b$/i.test(String(id)) ? 'b' : 'a')}
                                    onError={(e) => onImgError(e, /_b$/i.test(String(id)) ? 'b' : 'a')}
                                    alt={`opponent:hand:${id}`}
                                    draggable={false}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="pb-board pb-opponent rotate-safe" role="grid" aria-label="Opponent Board">
                {/* Row A (top): BANISH | Battle Zone (spans) | GRAVE */}
                <div
                    className="pb-slot pb-std"
                    data-menu-area="stack-slot"
                    data-stack="banish"
                    data-owner="opponent"
                    aria-label="Banish"
                    style={{ gridRow: 1, gridColumn: 9 }}
                    onDragOver={onOBanishDragOver}
                    onDrop={onOBanishDrop}
                >
                    {oBanishPile.length > 0 ? (
                        <div className="pb-slot-card">
                            <div className="pb-card-frame">
                                <CardZoom id={ensureFrontId(oBanishPile[0])} name={oBanishPile[0]} />
                                <img
                                    className="pb-card-img"
                                    src={imgSrc(oBanishPile[0], 'a')}
                                    alt={`opponent:banish:${oBanishPile[0]}:a`}
                                    draggable
                                    onDragStart={onOBanishDragStart}
                                    onError={(e) => onImgError(e, 'a')}
                                />
                            </div>
                        </div>
                    ) : null}
                    <div className="pb-pile-count" aria-label="Banish count">{oBanishPile.length}</div>
                </div>
                <div
                    className="pb-battle-zone"
                    data-name="Battle Zone"
                    style={{ gridRow: 1, gridColumn: '2 / span 7' }}
                />
                {[1, 2, 3, 4, 5, 6, 7].map((i) => {
                    const key = `ob${i}`;
                    const cardId = boardSlots[key];
                    const side = (slotSides && slotSides[key]) || 'a';
                    const isExhausted = exhaustedSlots?.has?.(key);

                    return (
                        <div
                            key={key}
                            className="pb-slot pb-rot battle"
                            data-name={i === 1 ? 'Battle' : ''}
                            style={{ gridRow: 1, gridColumn: i + 1 }}
                        /* NOTE: intentionally no onDragOver / onDrop here (non-droppable) */
                        >
                            <div className="pb-slot-inner" data-slot-key={key}>
                                {cardId && (
                                    <div
                                        className={`pb-slot-card${isExhausted ? ' is-exhausted' : ''}`}
                                        draggable
                                        onDragStart={onSlotCardDragStart && onSlotCardDragStart(key)}
                                        onDragEnd={onSlotCardDragEnd}
                                        data-menu-area="slot-card"
                                        data-card-id={cardId}
                                        data-slot-key={key}
                                        data-side={side}
                                        data-hoards-total={Object.values(slotResources?.[key] || {}).reduce((a, b) => a + (Number(b) || 0), 0)}
                                        title="Drag to another slot or back to opponent hand"
                                    >
                                        <div className="pb-card-frame">
                                            <CardZoom id={ensureFrontId(cardId)} name={cardId} />
                                            <img
                                                className="pb-card-img"
                                                src={imgSrc(cardId, side)}
                                                alt={`opponent:${cardId}:${side}`}
                                                onError={(e) => onImgError(e, side)}
                                                draggable="false"
                                            />
                                            {renderLabelBadges?.(slotLabels?.[key])}
                                            {renderCounterBadges?.(slotCounters?.[key])}
                                            {renderResourceBadges?.(slotResources?.[key])}
                                            {renderUnitStats?.(key, cardId)}
                                            {/^ob\d+$/.test(key) && battleRole?.[key] === 'attacker' && (
                                                <div className="pb-battle-badge attacker">ATTACKER</div>
                                            )}
                                            {/^ob\d+$/.test(key) && battleRole?.[key] === 'blocker' && (
                                                <div className="pb-battle-badge blocker">BLOCKER</div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div
                    className="pb-slot pb-std"
                    data-menu-area="stack-slot"
                    data-stack="grave"
                    data-owner="opponent"
                    aria-label="Grave"
                    style={{ gridRow: 3, gridColumn: 9 }}
                    onDragOver={onOGraveDragOver}
                    onDrop={onOGraveDrop}
                >
                    {oGravePile.length > 0 ? (
                        <div className="pb-slot-card">
                            <div className="pb-card-frame">
                                <CardZoom id={ensureFrontId(oGravePile[0])} name={oGravePile[0]} />
                                <img
                                    className="pb-card-img"
                                    src={imgSrc(oGravePile[0], 'a')}
                                    alt={`opponent:grave:${oGravePile[0]}:a`}
                                    draggable
                                    onDragStart={onOGraveDragStart}
                                    onError={(e) => onImgError(e, 'a')}
                                />
                            </div>
                        </div>
                    ) : null}
                    <div className="pb-pile-count" aria-label="Grave count">{oGravePile.length}</div>
                </div>

                {/* Row B (middle): PARTNER | Units 1..7 | DECK */}
                <Slot k="opartner" className="pb-slot pb-std" name="Partner" style={{ gridRow: 2, gridColumn: 1 }} />
                {U.map((i) => (
                    <Slot
                        key={`ou${i}`}
                        k={`ou${i}`}
                        className="pb-slot pb-rot unit"
                        name={`Unit${i}`}
                        style={{ gridRow: 2, gridColumn: i + 1 }}
                    />
                ))}
                <div
                    className="pb-slot pb-std"
                    data-menu-area="stack-slot"
                    data-stack="deck"
                    data-owner="opponent"
                    aria-label="Deck"
                    style={{ gridRow: 2, gridColumn: 9 }}
                    onDragOver={onODeckDragOver}
                    onDrop={onODeckDrop}
                >
                    {oDeckPile.length > 0 && (
                        <img
                            className="pb-card-img"
                            src={imgSrc('card0000', 'b')}
                            alt="opponent:pile:deck"
                            draggable
                            onDragStart={onODeckDragStart}
                            onError={(e) => onImgError(e, 'b')}
                        />
                    )}
                    <div className="pb-pile-count" aria-label="Deck count">{oDeckPile.length}</div>
                </div>

                {/* Row C (bottom): Supports 1..7 | SHIELD */}
                {S.map((i) => (
                    <Slot
                        key={`os${i}`}
                        k={`os${i}`}
                        className="pb-slot pb-rot support"
                        name={`Support${i}`}
                        style={{ gridRow: 3, gridColumn: i + 1 }}
                    />
                ))}
                <div
                    className="pb-slot pb-std"
                    data-menu-area="stack-slot"
                    data-stack="shield"
                    data-owner="opponent"
                    aria-label="Shield"
                    style={{ gridRow: 1, gridColumn: 1 }}
                    onDragOver={onOShieldDragOver}
                    onDrop={onOShieldDrop}
                >
                    {oShieldPile.length > 0 && (
                        <img
                            className="pb-card-img"
                            src={imgSrc('card0000', 'b')}
                            alt="opponent:pile:shield"
                            draggable
                            onDragStart={onOShieldDragStart}
                            onError={(e) => onImgError(e, 'b')}
                        />
                    )}
                    <div className="pb-pile-count" aria-label="Shield count">{oShieldPile.length}</div>
                </div>
            </div>
        </div>
    );
}
