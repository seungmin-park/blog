const KEY = "blog-editor-notes-v2";
export function createStore(storage) {
  function read() {
    try {
      const raw = storage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : { notes: {}, active: null };
      if (!data.notes || typeof data.notes !== "object") throw Error();
      return data;
    } catch {
      throw new Error(
        "저장된 원고를 읽지 못했습니다. 복구 전까지 기존 저장본을 보존합니다.",
      );
    }
  }
  function write(data) {
    storage.setItem(KEY, JSON.stringify(data));
  }
  return {
    list() {
      return Object.values(read().notes)
        .filter((note) => !note.archived)
        .sort((a, b) => b.updated - a.updated);
    },
    trash() {
      return Object.values(read().notes)
        .filter((note) => note.archived)
        .sort((a, b) => b.updated - a.updated);
    },
    archive(id) {
      const data = read();
      if (!data.notes[id]) throw new Error("원고가 없습니다.");
      data.notes[id] = {
        ...data.notes[id],
        archived: true,
        revision: data.notes[id].revision + 1,
        updated: Date.now(),
      };
      if (data.active === id) data.active = null;
      write(data);
    },
    restore(id) {
      const data = read();
      if (!data.notes[id]) throw new Error("원고가 없습니다.");
      data.notes[id] = {
        ...data.notes[id],
        archived: false,
        revision: data.notes[id].revision + 1,
        updated: Date.now(),
      };
      data.active = id;
      write(data);
      return data.notes[id];
    },
    get(id) {
      return read().notes[id];
    },
    active() {
      const data = read();
      return data.notes[data.active];
    },
    create(value) {
      const data = read();
      const note = {
        ...value,
        id: crypto.randomUUID(),
        revision: 1,
        updated: Date.now(),
      };
      data.notes[note.id] = note;
      data.active = note.id;
      write(data);
      return note;
    },
    save(note, revision) {
      const data = read();
      if (data.notes[note.id]?.revision !== revision)
        throw new Error(
          "다른 탭에서 이 원고가 변경됐습니다. 현재 내용을 내려받은 뒤 다시 열어 주세요.",
        );
      const next = { ...note, revision: revision + 1, updated: Date.now() };
      data.notes[note.id] = next;
      data.active = note.id;
      write(data);
      return next;
    },
    select(id) {
      const data = read();
      if (!data.notes[id]) throw new Error("원고가 없습니다.");
      data.active = id;
      write(data);
      return data.notes[id];
    },
  };
}
