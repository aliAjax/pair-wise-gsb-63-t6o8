/**
 * 对可能是 Vue reactive 代理的数据做深拷贝。
 * 领域数据全部为 JSON 可序列化结构（时间以字符串保存），
 * 直接 structuredClone 代理对象在部分运行时会抛 DataCloneError。
 */
export function deepClone<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
