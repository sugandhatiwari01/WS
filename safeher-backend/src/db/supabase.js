const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const client = url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
const ensureClient = () => {
  if (!client) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required.");
  return client;
};

const get = (document, path) => path.split(".").reduce((value, part) => value == null ? undefined : value[part], document);
const equal = (actual, expected) => String(actual) === String(expected);
function matches(document, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some(condition => matches(document, condition));
    const actual = get(document, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === "$in") return value.some(item => equal(actual, item));
        if (operator === "$nin") return !value.some(item => equal(actual, item));
        if (operator === "$ne") return !equal(actual, value);
        if (operator === "$exists") return (actual !== undefined) === value;
        if (operator === "$near") return true;
        return equal(actual, value);
      });
    }
    return expected === null ? actual == null : equal(actual, expected);
  });
}

function project(document, fields) {
  if (!fields) return document;
  if (fields.includes("+")) return document;
  const include = fields.split(/\s+/).filter(Boolean).filter(field => !field.startsWith("-"));
  const exclude = fields.split(/\s+/).filter(field => field.startsWith("-")).map(field => field.slice(1));
  if (!include.length) {
    const copy = { ...document };
    exclude.forEach(field => delete copy[field]);
    return copy;
  }
  return Object.fromEntries(include.filter(field => document[field] !== undefined).map(field => [field, document[field]]));
}

class Query {
  constructor(model, operation, filter, update, options) {
    this.model = model; this.operation = operation; this.filter = filter; this.update = update; this.options = options || {};
    this.sortSpec = null; this.limitValue = null; this.fields = null;
  }
  sort(spec) { this.sortSpec = typeof spec === "string" ? spec.split(/\s+/).map(field => [field.replace("-", ""), field.startsWith("-") ? -1 : 1]) : Object.entries(spec); return this; }
  limit(value) { this.limitValue = value; return this; }
  select(fields) { this.fields = fields; return this; }
  populate() { return this; }
  async exec() {
    const { data, error } = await ensureClient().from("app_documents").select("id,collection,data,created_at,updated_at").eq("collection", this.model.collection);
    if (error) throw error;
    let records = (data || []).map(row => ({ ...row.data, _id: row.id, createdAt: row.created_at, updatedAt: row.updated_at }));
    records = records.filter(record => matches(record, this.filter));
    if (this.sortSpec) for (const [field, direction] of [...this.sortSpec].reverse()) records.sort((a, b) => {
      const left = get(a, field); const right = get(b, field);
      return left === right ? 0 : (left > right ? 1 : -1) * Number(direction);
    });
    if (this.limitValue != null) records = records.slice(0, this.limitValue);
    records = records.map(record => this.model.hydrate(project(record, this.fields)));
    if (this.operation === "findOne") return records[0] || null;
    if (this.operation === "findOneAndUpdate") {
      const record = records[0];
      if (!record && this.options.upsert) {
        const values = Object.fromEntries(Object.entries(this.filter).filter(([key]) => !key.startsWith("$") && typeof this.filter[key] !== "object"));
        return this.model.create({ ...values, ...(this.update.$set || this.update) });
      }
      if (!record) return null;
      const changes = this.update.$set || this.update;
      Object.assign(record, changes);
      await record.save();
      return record;
    }
    return records;
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
}

function createModel(collection, defaults = {}, methods = {}) {
  class Model {
    constructor(values = {}) {
      Object.assign(this, defaults, values);
      this._id = this._id || crypto.randomUUID();
      this.createdAt = this.createdAt || new Date().toISOString();
      this.updatedAt = this.updatedAt || this.createdAt;
    }
    static get collection() { return collection; }
    static hydrate(values) { return new Model(values); }
    static find(filter) { return new Query(Model, "find", filter); }
    static findOne(filter) { return new Query(Model, "findOne", filter); }
    static findById(id) { return new Query(Model, "findOne", { _id: id }); }
    static findOneAndUpdate(filter, update, options) { return new Query(Model, "findOneAndUpdate", filter, update, options); }
    static async create(values) { const record = new Model(values); await record.save(); return record; }
    static async exists(filter) { return Boolean(await new Query(Model, "findOne", filter).exec()); }
    static async deleteOne(filter) {
      const record = await new Query(Model, "findOne", filter).exec();
      if (!record) return { deletedCount: 0 };
      const { error } = await ensureClient().from("app_documents").delete().eq("id", record._id).eq("collection", collection);
      if (error) throw error;
      return { deletedCount: 1 };
    }
    static async createIndexes() {}
    async save() {
      if (methods.beforeSave) await methods.beforeSave.call(this);
      this.updatedAt = new Date().toISOString();
      const data = { ...this }; delete data._id; delete data.createdAt; delete data.updatedAt;
      const { error } = await ensureClient().from("app_documents").upsert({
        id: this._id, collection, data, created_at: this.createdAt, updated_at: this.updatedAt
      });
      if (error) throw error;
      return this;
    }
    toJSON() { return { ...this }; }
  }
  Object.entries(methods).filter(([name]) => name !== "beforeSave").forEach(([name, method]) => { Model.prototype[name] = method; });
  return Model;
}

module.exports = { client, createModel, isConfigured: Boolean(client) };
