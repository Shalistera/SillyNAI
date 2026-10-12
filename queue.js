export class ImageQueue {
    pending = [];
    active = null;
    ids = new Set();

    enqueue(job) {
        if (this.ids.has(job.id)) return false;
        this.ids.add(job.id);
        this.pending.push(job);
        job.onState?.('queued');
        void this.drain();
        return true;
    }

    cancel(predicate = () => true) {
        this.pending = this.pending.filter(job => {
            if (!predicate(job)) return true;
            this.ids.delete(job.id);
            job.onState?.('cancelled');
            return false;
        });
        if (this.active && predicate(this.active.job)) this.active.controller.abort();
    }

    async drain() {
        if (this.active) return;
        while (this.pending.length) {
            const job = this.pending.shift();
            const controller = new AbortController();
            this.active = { job, controller };
            try {
                if (!job.valid()) continue;
                job.onState?.('running');
                const result = await job.run(controller.signal);
                if (!controller.signal.aborted && job.valid()) await job.complete(result);
            } catch (error) {
                if (!controller.signal.aborted && job.valid()) {
                    try { await job.failed?.(error); }
                    catch { console.warn('NovelAI: could not persist the task failure; continuing the queue.'); }
                }
            } finally {
                this.ids.delete(job.id);
                this.active = null;
                job.onState?.('idle');
            }
        }
    }
}

export function sameTarget(context, target) {
    return context.getCurrentChatId() === target.chatId
        && context.characterId === target.characterId
        && context.groupId === target.groupId
        && context.chat[target.index] === target.message
        && (target.message.swipe_id ?? 0) === target.swipe
        && target.message.mes === target.text;
}

// ST streaming and non-streaming emit the render/end events in opposite orders.
export class GenerationTracker {
    current = null;
    start(chatId) { this.current = { chatId, messages: new Set(), handled: new Set(), ended: false }; }
    clear() { this.current = null; }
    rendered(chatId, index) {
        if (this.current?.chatId !== chatId) return [];
        this.current.messages.add(index);
        return this.release();
    }
    ended(chatId) {
        if (this.current?.chatId !== chatId) return [];
        this.current.ended = true;
        return this.release();
    }
    release() {
        if (!this.current?.ended) return [];
        const result = [...this.current.messages].filter(index => !this.current.handled.has(index));
        result.forEach(index => this.current.handled.add(index));
        if (result.length) this.current = null;
        return result;
    }
}
