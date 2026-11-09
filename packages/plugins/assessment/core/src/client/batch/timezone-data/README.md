# 时区城市名

`cities.json` 摘自 Unicode CLDR 48.0.0 的
[简体中文](https://github.com/unicode-org/cldr-json/blob/48.0.0/cldr-json/cldr-dates-full/main/zh/timeZoneNames.json)和
[英文](https://github.com/unicode-org/cldr-json/blob/48.0.0/cldr-json/cldr-dates-full/main/en/timeZoneNames.json)
`zone.*.exemplarCity`，并按[时区别名表](https://github.com/unicode-org/cldr-json/blob/48.0.0/cldr-json/cldr-bcp47/bcp47/timezone.json)
补齐新旧标识。值为中文名，或 `[中文名或 null, 英文例外名称]`；英文默认使用标识的最后一段。
这些名称只用于下拉列表的次要说明；可选标识与偏移仍由运行时提供。

Unicode 数据许可见 [LICENSE](LICENSE)。
