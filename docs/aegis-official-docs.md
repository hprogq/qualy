# 安装和初始化.md

﻿支持 CDN 和 NPM 两种方式安装并初始化 SDK 。

## 方式1：以 CDN 方式安装并初始化 SDK

1. 在 HTML 页面的`<head></head>`标签中引入下列代码。

   【html】

   ```javascript
   <script src="https://tam.cdn-go.cn/aegis-sdk/latest/aegis.min.js"></script>
   ```

   该 cdn 使用 “h3-Q050” 协议，默认 cache-control 为 max-age=666，如果需要修改 cache-control，可以添加参数 max_age，例如：

   【html】

   ```javascript
   <script src="https://tam.cdn-go.cn/aegis-sdk/latest/aegis.min.js?max_age=3600"></script>
   ```

2. 参考下列步骤新建一个 Aegis 实例，传入相应的配置，初始化 SDK 。

   【javascript】

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewhxxxxxx', // 应用ID，即上报ID
     uin: 'xxx', // 用户唯一 ID（可选）
     reportApiSpeed: true, // 接口测速
     reportAssetSpeed: true, // 静态资源测速
     hostUrl: 'https://rumt-zh.com', // 上报域名，中国大陆 rumt-zh.com
     spa: true, // spa 应用页面跳转的时候开启 pv 计算
   })
   ```

## 方式2：以 NPM 方式安装并初始化 SDK

1. 执行下列命令，在 npm 仓库安装 aegis-web-sdk。

   【Linux】

   ```javascript
   $ npm install --save aegis-web-sdk

   ```

2. 参考下列步骤新建一个 Aegis 实例，传入相应的配置，初始化 SDK 。

   【javascript】

   ```javascript
   import Aegis from 'aegis-web-sdk'

   const aegis = new Aegis({
     id: 'pGUVFTCZyewhxxxxxx', // 应用ID，即上报ID
     uin: 'xxx', // 用户唯一 ID（可选）
     reportApiSpeed: true, // 接口测速
     reportAssetSpeed: true, // 静态资源测速
     hostUrl: 'https://rumt-zh.com', // 上报域名，中国大陆 rumt-zh.com
     spa: true, // spa 应用页面跳转的时候开启 pv 计算
   })
   ```

   > **说明：**
   >
   > - 为了不遗漏数据，须尽早进行初始化。当您完成安装并初始化 SDK 之后，可以开始使用前端性能监控提供的以下功能：
   > - 错误监控：JS 执行错误、Promise 错误、Ajax 请求异常、资源加载失败、返回码异常、PV 上报、白名单检测等。
   > - 测速功能：页面性能测速、接口测速、静态资源测速。
   > - 数据统计和分析：可在 前端性能监控 > [数据总览](https://console.cloud.tencent.com/monitor/rum?region=ap-guangzhou) 上进行各个维度的数据分析。
   > - aegis-sdk 默认使用 `https://aegis.qq.com` 作为上报域名，您可以通过 `hostUrl` 参数来控制上报域名。
   > - 国内可以选择使用 `https://rumt-zh.com` 作为上报域名。
   > - 新加坡地区可以选择使用 `https://rumt-sg.com` 作为上报域名。
   > - 硅谷地区可以选择使用 `https://rumt-us.com` 作为上报域名。

# 日志上报.md

﻿日志查询功能需您上报日志后，才能正常使用。本文将为您介绍如何上报日志到前端性能监控。

## 前提条件

参见 [安装和初始化](https://cloud.tencent.com/document/product/248/87187) 文档，选择任意一种方式完成前端性能监控 SDK 的安装和初始化。

## 配置 SDK

引入下列参数，配置 SDK ，完成日志上报。

【js】

```javascript
// info 可以上报任意字符串，数字，数组，对象，但是只有打开页面的用户在名单中才会上报
aegis.info('test')
aegis.info('test', 123, ['a', 'b', 'c', 1], { a: '123' })

// 也可以上报特定的对象，支持用户传 ext 参数和 trace 参数
// 注意这种 case 一定要传 msg 字段
aegis.info({
  msg: 'test',
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})

// 不同于 info，infoAll 表示全量上报
aegis.infoAll({
  msg: 'test',
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})

// error 用来表示 JS 错误日志，也是全量上报，一般用于开发者主动获取JS异常，然后进行上报
aegis.error({
  msg: 'test',
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})
aegis.error(new Error('主动上报一个错误'))

// report 默认是 aegis.report 的日志类型，但是现在您可以传入任何日志类型了
aegis.report({
  msg: '这是一个ajax错误日志',
  level: Aegis.logType.AJAX_ERROR,
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})
```

> **说明：**
>
> 如您需要使用 ext4 - ext10的扩展字段，您还需要在 [前端性能监控 > 应用管理 > 自定义字段枚举配置](https://console.cloud.tencent.com/monitor/rum/manage?region=ap-guangzhou&currentTab=ext-manage) 模块上传**自定义字段枚举表**，以确保 ext4 - ext10的内容展示为您预期效果。

Aegis.logType 枚举值如下：

【js】

```javascript
export enum LogType {
  API_RESPONSE = '1', // 白名单中的用户，页面上的所有 API 返回都将会被上报
  INFO = '2', // aegis.info、aegis.infoAll 上报的日志
  ERROR = '4', // js 错误
  PROMISE_ERROR = '8', // promise 错误
  AJAX_ERROR = '16', // ajax 错误
  SCRIPT_ERROR = '32', // script 加载失败
  IMAGE_ERROR = '64', // 图片加载失败
  CSS_ERROR = '128', // css 加载失败
  CONSOLE_ERROR = '256', // console.error 监控（目前暂未支持）
  MEDIA_ERROR = '512', // 音视频加载失败
  RET_ERROR = '1024', // retcode 返回码异常
  REPORT = '2048', // aegis.report 上报日志默认level
  PV = '4096', // 页面 PV
  EVENT = '8192', // 自定义事件
  PAGE_NOT_FOUND_ERROR = '16384', // 小程序 页面不存在
  WEBSOCKET_ERROR = '32768', // websocket错误
  BRIDGE_ERROR = '65536', // js bridge 错误
}

```

# aid.md

aid 是 Aegis SDK 为每个用户设备分配的唯一标识，存储在浏览器的 localStorage ，用于区分用户计算 UV 等。只有用户清理浏览器缓存后， aid 才会更新。

## 前提条件

参见 [安装和初始化](https://cloud.tencent.com/document/product/248/87187) 文档，选择任意一种方式完成前端性能监控 SDK 的安装和初始化。

## 自定义 aid 上报规则

您可以根据下列算法自定义 aid 上报规则：

【js】

```javascript
async getAid(callback: Function) {
// 某些情况下操作 localStorage 会报错.
  try {
    let aid = await localStorage.getItem('AEGIS_ID');
    if (!aid) {
    aid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    localStorage.setItem('AEGIS_ID', aid);
    }
    callback?.(aid || '');
  } catch (e) {
    callback?.('');
  }
}

```

> **说明**
>
> 若您需要使用自己构造的 aid 作为上报规则，需要后端对 aid 的校验规则，规则如下：`/^[@=.0-9a-zA-Z_-]{4,36}$/`。

# 实例方法.md

﻿前端性能监控为您提供多种实例方法用于上报数据，您可以通过实例方法修改实例配置、自定义上报事件、自定义上报测试资源等。

本文为您介绍目前 RUM 提供的 Aegis 实例方法。
<table>
<tr>
<td rowspan="1" colspan="1" >参数</td>

<td rowspan="1" colspan="1" >用途</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >setConfig</td>

<td rowspan="1" colspan="1" >传入配置对象，包括用户 ID 和 UIN 等信息。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >info</td>

<td rowspan="1" colspan="1" >主要上报字段，用于上报白名单日志。<br>下列两种情况日志才会报到后台：<br>1. 在白名单的用户打开了前端页面。<br>2. 对应的页面发生了错误。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >infoAll</td>

<td rowspan="1" colspan="1" >主要上报字段，用于上报白名单日志。该上报与 info 唯一的区别： <br>info 指定用户上报。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >error</td>

<td rowspan="1" colspan="1" >主要上报字段，用于上报错误信息。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >report</td>

<td rowspan="1" colspan="1" >用来上报任意类型的日志信息。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >reportEvent</td>

<td rowspan="1" colspan="1" >上报自定义事件。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >reportTime</td>

<td rowspan="1" colspan="1" >上报自定义测速资源。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >time</td>

<td rowspan="1" colspan="1" >上报自定义测速资源，与 timeEnd 共同使用。适用于两个时间点之间时长的计算并上报。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >timeEnd</td>

<td rowspan="1" colspan="1" >上报自定义测速资源，与 time 共同使用。适用于两个时间点之间时长的计算并上报。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >destroy</td>

<td rowspan="1" colspan="1" >销毁 aegis 实例。</td>
</tr>
</table>

## 前提条件

参见 [安装和初始化](https://cloud.tencent.com/document/product/248/87187) 文档，选择任意一种方式完成前端性能监控 SDK 的安装和初始化。

## 实例方法

### setConfig

该方法用于修改实例配置，使用场景如下。

1. 可获取到用户 UIN，可同时传入配置用户 ID 和 UIN 两个实例对象，进行实例化。

   【js】

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewxxxxx',
     uin: '777',
   })
   ```

2. 通常情况下，我们并不能一开始就获取到用户的 `uin`。若在获取 UIN 的这段时间不进行实例化，这期间发生的错误前端性能监控将无法监听。针对这种情况，我们可以先传入 ID 进行实例化，引用 setConfig 传入 UIN，示例如下：

   【js】

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewxxxxx',
   })

   // 拿到 uin 之后...
   aegis.setConfig({
     uin: '6666',
   })
   ```

   注意：该方法对 config 进行覆盖时采用**浅合并**逻辑，并不会做深度合并。

   ```javascript
   // 初始化时传入如下配置
   const aegis = new Aegis({
       spa: true,
       reportApiSpeed: true,
       pagePerformance: {
         firstScreenInfo： true
       }
   })


   // 调用 setConfig 修改配置
   aegis.setConfig({
       spa: false,
       reportAssetSpeed: true,
       pagePerformance: {
         urlHandler() {
           return 'xxx'
         }
       }
   })

   // 结果如下：
   {
       spa: false,
       reportApiSpeed: true,
       reportAssetSpeed: true,
       pagePerformance: {
         urlHandler() {
           return 'xxx'
         }
       }
   }
   ```

### info、infoAll、error 和 report

这几个方法是前端性能监控提供的主要上报手段。

【js】

```javascript
// info 可以上报任意字符串、数字、数组、对象，但是只有打开页面的用户在名单中才会上报
aegis.info('test')
aegis.info('test', 123, ['a', 'b', 'c', 1], { a: '123' })

// 也可以上报特定的对象，支持用户传 ext 参数和 trace 参数
// 注意这种 case 一定要传 msg 字段
aegis.info({
  msg: 'test',
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})

// 不同于 info，infoAll 表示全量上报
aegis.infoAll({
  msg: 'test',
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})

// error 用来表示 JS 错误日志，也是全量上报，一般用于开发者主动获取 JS 异常，然后进行上报
aegis.error({
  msg: 'test',
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})
aegis.error(new Error('主动上报一个错误'))

// report 默认是 aegis.report 的日志类型，但是现在您可以传入任何日志类型了
aegis.report({
  msg: '这是一个ajax错误日志',
  level: '4', // 日志等级，具体取值可参考日志等级小节。
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})
```

> **说明：**
>
> 如您需要使用 ext4 - ext10的扩展字段，您还需要在 [前端性能监控 > 应用管理 > 自定义字段枚举配置](https://console.cloud.tencent.com/monitor/rum/manage?region=ap-guangzhou&currentTab=ext-manage) 模块上传**自定义字段枚举表**，以确保 ext4 - ext10的内容展示为您预期效果。

Aegis.logType 枚举值如下：

【js】

```javascript
export enum LogType {
  API_RESPONSE = '1', // 白名单中的用户，页面上的所有 API 返回都将会被上报
  INFO = '2', // aegis.info、aegis.infoAll 上报的日志
  ERROR = '4', // js 错误
  PROMISE_ERROR = '8', // promise 错误
  AJAX_ERROR = '16', // ajax 错误
  SCRIPT_ERROR = '32', // script 加载失败
  IMAGE_ERROR = '64', // 图片加载失败
  CSS_ERROR = '128', // css 加载失败
  CONSOLE_ERROR = '256', // console.error 监控（目前暂未支持）
  MEDIA_ERROR = '512', // 音视频加载失败
  RET_ERROR = '1024', // retcode 返回码异常
  REPORT = '2048', // aegis.report 上报日志默认level
  PV = '4096', // 页面 PV
  EVENT = '8192', // 自定义事件
  PAGE_NOT_FOUND_ERROR = '16384', // 小程序页面不存在
  WEBSOCKET_ERROR = '32768', // websocket错误
  BRIDGE_ERROR = '65536', // js bridge 错误
}

```

### reportEvent

该方法可用来上报自定义事件，系统将会自动统计上报事件的各项指标，例如：PV、平台分布等。
reportEvent 可以支持字符串和对象两种类型上报参数。

#### 字符串类型

【js】

```javascript
aegis.reportEvent('XXX请求成功')
```

#### 对象类型

ext1、ext2、ext3、ext4、ext5、ext6、ext7、ext8、ext9、ext10默认使用 new Aegis 的时候传入的参数，自定义事件上报的时候，可以覆盖默认值。

【js】

```javascript
aegis.reportEvent({
  name: 'XXX请求成功', // 必填
  ext1: '额外参数1',
  ext2: '额外参数2',
  ext3: '额外参数3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
})
```

> **注意：**
>
> - 额外参数的 key 是固定的，目前只支持 ext1、ext2、ext3、ext4、ext5、ext6、ext7、ext8、ext9、ext10。
> - 如您需要使用 ext4 - ext10的扩展字段，您还需要在 [前端性能监控 > 应用管理 > 自定义字段枚举配置](https://console.cloud.tencent.com/monitor/rum/manage?region=ap-guangzhou&currentTab=ext-manage) 模块上传**自定义字段枚举表**，以确保 ext4 - ext10的内容展示为您预期效果。

### reportTime

该方法可用来上报自定义测速，例如：

【js】

```javascript
// 假如‘onload’的时间是1s
aegis.reportTime('onload', 1000)
```

或者如果需要使用额外参数，可以传入对象类型参数，ext1、ext2、ext3、ext4、ext5、ext6、ext7、ext8、ext9、ext10会覆盖默认值。

【js】

```javascript
aegis.reportTime({
  name: 'onload', // 自定义测速 name
  duration: 1000, // 自定义测速耗时(0 - 60000)
  ext1: 'test1',
  ext2: 'test2',
  ext3: 'test3',
  // 上报的 ext4-10需要在控制台配置自定义字段枚举表，上报的内容如果不在自定义字段枚举表内会被改写为 undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
})
```

> **说明：**
>
> - `onload` 可以修改为其他的命名。
> - 如您需要使用 ext4 - ext10的扩展字段，您还需要在 [前端性能监控 > 应用管理 > 自定义字段枚举配置](https://console.cloud.tencent.com/monitor/rum/manage?region=ap-guangzhou&currentTab=ext-manage) 模块上传**自定义字段枚举表**，以确保 ext4 - ext10的内容展示为您预期效果。

### time 和 timeEnd

该方法同样可用来上报自定义测速，适用于两个时间点之间时长的计算并上报，例如：

【js】

```javascript
aegis.time('complexOperation')
/**
 * .
 * .
 * 做了很久的复杂操作之后。
 * .
 * .
 */
aegis.timeEnd('complexOperation') /** 此时日志已经报上去了**/
```

> **说明：**
>
> - `complexOperation` 可以修改为其他的命名。
> - 自定义测速是用户上报任意值，服务端对其进行统计和计算。由于服务端不能做脏数据处理，建议用户在上报端进行统计值限制，防止脏数据对整体产生影响。
> - 目前 Aegis 只支持0 - 60000的数值计算，如果大于该值，建议进行合理改造。

### destroy

销毁实例进程，销毁后数据不再上报，并且 Aegis 不再收集用户数据。

【js】

```javascript
aegis.destroy()
```

### 日志等级

| 键（level） | 值（name）         |
| ----------- | ------------------ |
| 1           | '白名单日志'       |
| 2           | '一般日志'         |
| 4           | '错误日志'         |
| 8           | 'Promise 错误'     |
| 16          | 'Ajax 请求异常'    |
| 32          | 'JS 加载异常'      |
| 64          | '图片加载异常'     |
| 128         | 'css 加载异常'     |
| 256         | 'console.error'    |
| 512         | '音视频资源异常'   |
| 1024        | 'retcode 异常'     |
| 2048        | 'aegis report'     |
| 4096        | 'PV'               |
| 8192        | '自定义事件'       |
| 16384       | '小程序页面不存在' |
| 32768       | ''websocket 错误'  |
| 65536       | 'js bridge 错误'   |

# 白名单.md

白名单功能是适用于开发者针对特定的用户上报更多的信息。为了过滤部分用户，并减少用户的接口请求次数，因此 RUM 提供了白名单功能，并设定了白名单的逻辑。
白名单逻辑如下：

1. 白名单用户会上报全部的 API 请求信息，包括接口请求和请求结果。

2. 白名单用户可以使用 info 接口上报数据。

3. info 和 infoAll：在开发者实际体验过程中，白名单用户可以添加更多的日志，并且使用 info 进行上报。infoAll 会对所有用户无差别进行上报，因此可能导致日志量上报巨大。

4. 通过接口 whitelist 来判断当前用户是否是白名单用户，白名单用户的返回结果会绑定在 aegis 实例上 (aegis.isWhiteList) 用来给开发者使用。

5. 为了减少开发者使用负担，白名单用户是针对业务系统生效。您可以在 [应用管理 > 白名单管理](https://console.cloud.tencent.com/monitor/rum/manage?region=ap-guangzhou&currentTab=whitelist) 内创建白名单，则业务系统下全部应用都对该白名单用户生效。

# 钩子函数.md

您可以使用钩子函数对某些资源的测速上报进行自定义配置，系统将会为您计算、统计函数执行时间等。您可以在 [自定义上报](https://console.cloud.tencent.com/monitor/rum/custom) 页面选择**自定义测速**，进行多维度分析函数执行耗时。

## onBeforeRequest

这个钩子函数会在所有请求发送之前被调用，所有请求内容都会传入它的参数中，必须返回待发送的内容。

```javascript
function changeURLArg(url, arg, arg_val) {
  var pattern = arg + ' = ([^&]*)'
  var replaceText = arg + '=' + arg_val
  if (url.match(pattern)) {
    var tmp = '/(' + arg + '=)([^&]*)/gi'
    tmp = url.replace(eval(tmp), replaceText)
    return tmp
  }
  return url
}
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  onBeforeRequest(log) {
    if (log.type === 'performance') {
      // Page speed test. Here, you can modify the content of `log`; for example, you can modify the `platform` for page speed test
      log.url = changeURLArg(log.url, 'platform', type)
    }
    return log
  },
})

// SEND_TYPE {
//   LOG = 'log',  // Log
//   SPEED = 'speed', // API and static resource speed test
//   PERFORMANCE = 'performance', // Page speed test
//   OFFLINE = 'offline', // Offline log upload
//   WHITE_LIST = 'whiteList', // Allowlist
//   VITALS = 'vitals', // Web Vitals
//   PV = 'pv', // Custom PV
//   EVENT = 'event', // Custom event
//   CUSTOM = 'custom', // Custom speed test
//   SDK_ERROR = 'sdkError', // SDK error
// }
```

## beforeReport

1. 该钩子将在日志报告之前执行（对应上报接口为 `/collect?`），例如：

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewxxxxx',
     beforeReport(log) {
       // Listen on the reported error below
       console.log(log) // {level: "4", msg: "An error occurred."}
       return log
     },
   })

   throw new Error('An error occurred.')
   ```

   > **注意：**
   >
   > 上述日志将具有以下字段：
   >
   > - level：日志级别。例如，'4'表示错误日志。
   > - msg：日志内容。
   >   日志级别如下：
   >
   > - { level: '1', name: 'API请求日志（允许的日志）' }
   > - { level: '2', name: '通用日志（aegis.info或aegis.infoAll）' }
   > - { level: '4', name: 'JavaScript执行错误' }
   > - { level: '8', name: 'Promise错误' }
   > - { level: '16', name: 'Ajax请求异常' }
   > - { level: '32', name: 'JavaScript加载异常' }
   > - { level: '64', name: '图像加载异常' }
   > - { level: '128', name: 'CSS加载异常' }
   > - { level: '256', name: 'console.error（保留）' }
   > - { level: '512', name: '音/视频资源异常' }
   > - { level: '1024', name: '返回码异常' }
   > - { level: '2048', name: 'aegis报告' }
   > - { level: 4096, name: 'PV' }
   > - { level: 8192, name: '自定义事件' }
   > - { level: 16384, name: '小程序页面不存在' }
   > - { level: 32768, name: 'websocket 错误' }
   > - { level: 65536, name: 'js bridge 错误' }

2. 如果该钩子返回 false，则不会报告日志。该功能可用于过滤掉不需要上报的错误，例如：

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewxxxxx',
     beforeReport(log) {
       if (log.level === '4' && log.msg && log.msg.indexOf('An error that doesn't need to be reported') !== -1) {
         return false
       }
       return log;
     }
   });
   throw new Error('An error that doesn't need to be reported'); // This error will not be reported
   ```

   在上面的示例代码中，如果错误内容包含关键字 `An error that doesn't need to be reported`，则不会报告给 RUM 后端。

## onReport

该 hook 在日志上报成功后执行，用法与 beforeReport 类似。它们唯一的区别是，该 hook 接收到的参数都是已经上报的日志，而 beforeReport 接收到的参数是待上报的日志。

## beforeReportSpeed

1. 该钩子将在速度测试数据报告之前（`/speed?`）被执行，例如：

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewxxxxx',
     reportApiSpeed: true,
     reportAssetSpeed: true,
     beforeReportSpeed(msg) {
       console.log(msg) // {url: "https://localhost:3001/example.e31bb0bc.js", method: "get", duration: 7.4, status: 200, type: "static"}
       return msg
     },
   })
   ```

   > **注意：**
   >
   > 上面的 msg 将具有以下字段：
   >
   > - url：资源的请求地址。
   > - type：资源类型。
   > - fetch：Aegis 将把该资源报告为 API 请求；
   > - static：Aegis 将把该资源报告为静态资源。
   > - duration：资源请求持续时间。
   > - method：在请求资源时使用的 HTTP 方法。
   > - status：服务器返回的状态码。
   > - payload：向您提供的完整资源请求信息（此字段不会被报告给 Aegis 后端，您可以操纵它）
   >   完整的数据结构如下：
   >
   > - payload.type: 资源请求类型，用于区分原始请求类型。有效值：'fetch'和'xhr'。
   > - payload.sourceURL: 完整的 URL 请求连接。
   > - payload.status: 请求状态码。
   > - payload.headers: 所有请求头，其值都是字符串。
   > - payload.data: 完整的请求资源，您可以自定义它。如果请求类型为 fetch，则为响应对象；如果请求类型为 xhr，则为 XMLHttpRequest 对象。

   在上面的示例代码中，每当 Aegis 收集到资源的加载详细信息后，将会使用这些详细信息（即 msg上面返回的）作为参数来调用 `beforeReportSpeed` 钩子。

2. 如果您配置了该钩子，Aegis 最终的上报内容将以钩子的执行结果为准。例如：

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewxxxxx',
     reportApiSpeed: true,
     reportAssetSpeed: true,
     beforeReportSpeed(msg) {
       msg.type = 'static'
       return msg
     },
   })
   ```

   上面的代码中，将所有的 msg.type 设置为 static，这意味着所有的资源都将被当成静态资源进行上报，API 请求也将被报至静态资源中。

3. 您可以使用此钩子来纠正 Aegis 类型并判断错误的请求。

   如果您有一个 API `https://example.com/api`，其响应标头 Content-Type 为 text/html。正常情况下，RUM 会将此 API 报告为静态资源。但在您的业务中，必须报告为 API 请求，您可以使用以下钩子配置 Aegis 进行修正：

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewxxxxx',
     reportApiSpeed: true,
     reportAssetSpeed: true,
     beforeReportSpeed(msg) {
       if (msg.url === 'https://example.com/api') {
         msg.type = 'fetch'
       }
     },
   })
   ```

4. 您还可以屏蔽某些资源的测速上报，例如：

   ```javascript
   const aegis = new Aegis({
     id: 'pGUVFTCZyewxxxxx',
     reportApiSpeed: true,
     reportAssetSpeed: true,
     beforeReportSpeed(msg) {
       // Speed test logs for resources whose address contains `https://example.com/api` will not be reported
       if (msg.url.indexOf('https://example.com/api') !== -1) {
         // If `false` is returned, the reporting of the speed test log will be blocked
         return false
       }
     },
   })
   ```

## beforeRequest

该钩子将会在所有的数据上报前执行，来帮助用户在数据上报前对其进行屏蔽和修改，当 beforeRequest 返回 false 就可以不上报该条日志，返回修改过后的 data 就可以实现对上报数据的修改，例如：

> **注意**
>
> SDK 版本应大于等于1.24.44。

【js】

```javascript
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  beforeRequest: function (data) {
    // 入参 data 的数据结构：{logs: {…}, logType: "log"}
    if (data.logType === 'log' && data.logs.msg.indexOf('otheve.beacon.qq.com') > -1) {
      // 拦截：日志类型为 log，且内容包含 otheve.beacon.qq.com 的请求
      return false
    }
    // 入参 data 数据结构：{logs: {}, logType: "speed"}
    if (data.logType === 'speed' && data.logs.url.indexOf('otheve.beacon.qq.com') > -1) {
      // 拦截：日志类型为 speed，并且接口 url 包含 otheve.beacon.qq.com 的请求
      return false
    }
    if (data.logType === 'performance') {
      // 修改：将性能数据的首屏渲染时间改为2s
      data.logs.firstScreenTiming = 2000
    }
    return data
  },
})
```

其中，data 将会有以下几个字段：

- logType：日志类型，有以下值：

  - custom：自定义测速

  - event：自定义事件

  - log：日志

  - performance：页面测速

  - pv：页面 PV

  - speed：接口和静态资源测速

  - vitals：web vitals

- logs：上报的日志内容：

  - 当 logType 为 'custom' 时，logs 数据类型为 `{name: "白屏时间", duration: 3015.7000000178814, ext1: '', ext2: '', ext3: ''}`

  - 当 logType 为 'event' 时，logs 数据类型为 `{name: "ios", ext1: "", ext2: "", ext3: ""}`

  - 当 logType 为 'performance' 时，logs 数据类型为 `{contentDownload: 2, dnsLookup: 0, domParse: 501, firstScreenTiming: 2315, resourceDownload: 2660, ssl: 4, tcp: 4, ttfb: 5}`

  - 当 logType 为 'speed' 时，logs 数据类型为 `{connectTime: 0, domainLookup: 0, duration: 508.2, isHttps: true, method: "get", status: 200, type: "static", url: "https://xxxxxx", urlQuery: "max_age=1296000"}`

  - 当 logType 为 'vitals' 时，logs 数据类型为 `{delta: 1100, entries: [PerformancePaintTiming], id: "v1-1629344653118-4916457684758", name: "LCP", value: 1100}`

  - 当 logType 为 'log' 时，logs 数据类型为 `{msg: "日志详情", level: '4', ext1: '', ext2: '', ext3: '', trace: ''}`

    > **说明**
    >
    > 其中 level 枚举值如下：
    >
    > - `{ level: '1', name: '接口请求日志（白名单日志）' }`
    > - `{ level: '2', name: '一般日志(aegis.info 或者 aegis.infoAll)' }`
    > - `{ level: '4', name: 'JS 执行错误' }`
    > - `{ level: '8', name: 'Promise 错误' }`
    > - `{ level: '16', name: 'Ajax 请求异常' }`
    > - `{ level: '32', name: 'JS 加载异常' }`
    > - `{ level: '64', name: '图片加载异常' }`
    > - `{ level: '128', name: 'css 加载异常' }`
    > - `{ level: '256', name: 'console.error (未启用)' }`
    > - `{ level: '512', name: '音视频资源异常' }`
    > - `{ level: '1024', name: 'retcode 异常' }`
    > - `{ level: '2048', name: 'aegis report' }`
    > - `{ level: 4096, name: 'PV' }`
    > - `{ level: 8192, name: '自定义事件' }`
    > - `{ level: 16384, name: '小程序 页面不存在' }`
    > - `{ level: 32768, name: 'websocket错误' }`
    > - `{ level: 65536, name:` 'js bridge 错误'`}`

    该钩子返回 false 时，本条日志将不会进行上报，该功能可用来过滤某些不需要上报的错误，可以用来过滤不希望上报的日志。

## afterRequest

该钩子将会在测速数据上报后被执行，例如：

> **注意**
>
> SDK 版本应大于等于1.24.44。

【js】

```javascript
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  afterRequest: function (data) {
    // {isErr: false, result: Array(1), logType: "log", logs: Array(4)}
    console.log(data)
  },
})
```

其中，data 将会有以下几个字段：

- isErr：请求上报接口是否错误

- result：上报接口的返回结果

- logs：上报的日志内容

- logType：日志类型，同 beforeRequest 中的 logType。

# 错误监控.md

﻿前端性能监控的 Aegis 的实例会自动进行 JS 执行错误、Promise 执行错误、Ajax（Fetch）请求异常等监控。本文将为您介绍各错误监控逻辑及处理方式。

> **注意：**
>
> Aegis 实例会对这些异常进行监控，当您只是引入了 SDK 而没有将其实例化时，Aegis 将不会上报数据。

## JS 执行错误

Aegis 通过监听 `window` 对象上的 `onerror` 事件来获取应用中的报错，并且通过解析错误和分析堆栈，将错误信息自动上报到后台服务中。该上报等级为 error ，所以当自动上报的错误达到阈值时，Aegis 将会自动告警，帮助您尽早发现异常。由于上报等级为 error ，自动上报也将影响应用的评分。

- 如果页面上引入了跨域的 JS 脚本，需要给对应的 `script` 标签添加 `crossorigin` 属性，否则 Aegis 将无法获取详细的错误信息。

- 如果用户使用的是 VUE 框架，请引入下列代码，获取错误并且主动上报。

  【js】

  ```javascript
  Vue.config.errorHandler = function (err, vm, info) {
    console.log(`Error: ${err.toString()}\nStack: ${err.stack}\nInfo: ${info}`)
    aegis.error(`Error: ${err.toString()}\nStack: ${err.stack}\nInfo: ${info}`)
  }
  ```

## Promise 执行错误

通过监听 `unhandledrejection` 事件，捕获到未被 `catch` 的 Promise 错误，为了页面的稳定性，建议您 `catch` 住所有的 Promise 错误。

## Ajax（Fetch）请求异常

Aegis 将会改写 `XMLHttpRequest` 对象，监听每次接口请求，Aegis 认为以下情况是异常情况：

- `HTTP status` 大于等于400。

- 请求超时，abort，跨域，cancel。

- 请求结束时 HTTP `status` 仍然是0，通常发生于请求失败。

  > **注意：**
  >
  > Aegis SDK 在错误发生的时候，不会主动收集接口请求参数和返回信息，如果需要对接口信息进行上报，可以使用 API 参数里面的 apiDetail 进行开启。

  【js】

  ```javascript
  new Aegis({
    api: {
      apiDetail: true,
    },
  })
  ```

## retcode 异常

Aegis 改写 `XMLHttpRequest` 对象之后，将获得 API 返回的内容，并尝试在内容中获取到本次请求的 `retcode`。

- retcode 的值默认会从用户返回 response body 的第一层（如果第一层取不到，再取第二层）的 code、ret、retcode、errcode 中获取。

- Aegis 默认 retcode 的值为0是正常的，非0都是异常的。当 `retcode` 发生异常的时候，会上报一个 retcode 异常的日志。

- 用户可以通过 api.retCodeHandler 对这个值和是否异常进行修正。

  > **说明：**
  >
  > 如何获取 `retcode` 以及哪些`retcode` 是正常的，详情请参见 [配置文档](https://cloud.tencent.com/document/product/248/87197) 。

## 资源加载失败

页面元素发出的请求如果失败，将会被 `window.onerror` 事件捕获到（捕获阶段），Aegis 正是通过这个特性监听的资源加载失败。Aegis 监听了以下资源：

- `<link>` 标签请求的 css、font 等。

- `<script>` 标签请求的脚本。

- `<audio>`、`<video>` 标签请求的多媒体资源。

## WebSocket 异常

Aegis 默认不会对全局 WebSocket 对象进行重写，默认不会监控 WebSocket 相关错误，如果需要打开相关功能可以在创建 Aegis 对象时设置 websocketHack: true。

【js】

```javascript
new Aegis({
  id: '',
  websocketHack: true,
})
```

## 白屏异常

### 检测时机

1. 发生错误时，包括 js 错误、promise 错误、资源、api 请求错误。

2. 页面 dom 结构发生变化时。

### 检测方式

采用米字采样法，每边采集9个点，共33个点（默认，可配置），当采样点是容器元素（默认为["#app", "html", "body", "#root"]， 可配置）的个数比例大于70%会被判定为白屏，触发白屏后，在2秒（默认，可配置）后会再次触发一次检测， 如果两次检测都为白屏，则上报一次白屏事件。

### 开启方式

在初始化 Aegis 时，设置 blankScreen 为 true 或 json 时会开启白屏。为 true 时使用默认的配置，如需对白屏参数做进一步配置，可在 json 中使用相关参数配置。

```javascript
// 传入 true 打开， 使用默认配置
const aegis = new window.Aegis({
  id: '',
  blankScreen: true,
})

// 配置相关参数打开
const aegis = new window.Aegis({
  id: '',
  blankScreen: {
    reDetectInterval: 2000,
    everySideSampleNumber: 9,
  },
})
```

白屏所有配置参数如下：

```java
interface BlankScreenConfig {
  /**
   * 空白元素选择器，也可以认为是页面渲染的根节点/容器节点，默认为 ['body', 'html', '#app', '#root'],
   * 如果有骨架屏，推荐骨架屏的选择器，也放到根节点
   * 如果采样点在此范围内，则认为该点为一个空白点
   */
  containers?: string[];
  /**
   * 忽略的容器节点/占位/空白节点元素的配置，避免误检
   */
  ignoreContainers?: string[];
  /**
   * 检测开始的位置, 默认左上角0,0
   */
  detectStartPosition?: {
    x: number;
    y: number;
  };
  /**
   * 空白节点比例，比例越大，相对越精准，默认70%
   */
  emptyElementsPercent?: number;
  /**
   * 相同元素检测比例，比例越大，相对越准确, 默认70%
   */
  sameElementsPercent?: number;
  /**
   * debounce间隔，防止触发太频繁
   */
  debounceDuration?: number;
  /**
   * 每条边采样几个，默认9个，越高越精准，但也可能会更耗时
   */
  everySideSampleNumber?: number;
  /**
   * 复检的时间间隔
   */
  reDetectInterval?: number;
}
```

# 性能监控.md

﻿您可以通过本文了解页面测速、接口测试、资源测速的统计方式和传入配置等信息。

## 页面测速

> **说明：**
>
> RUM 默认为您开启页面测速功能。

当您成功安装和初始化 SDK 后，Aegis 实例默认会上报以下指标：

1. **DNS 查询**：domainLookupEnd - domainLookupStart；

2. **TCP 连接**：connectEnd - connectStart；

3. **SSL 建连**：requestStart - secureConnectionStart；

4. **请求响应**：responseStart - requestStart；

5. **内容传输**：responseEnd - responseStart；

6. **内容解析**：domInteractive - domLoading；

7. **资源加载**：loadEventStart - domInteractive；

8. **首屏耗时**：监听页面打开3s内的**首屏** DOM 变化，并认为 DOM 变化数量最多的那一刻为首屏框架渲染完成时间（SDK 初始化后 setTimeout 3s 收集首屏元素，由于 JS 是在单线程环境下执行，收集时间点可能大于 3s）；

9. **LCP**：最大内容渲染时间，从谷歌 Web Vitals 指标中采集。

   > **说明：**
   >
   > 1-7 项页面打开性能指标计算说明可从 [PerformanceTiming](https://developer.mozilla.org/zh-CN/docs/Web/API/PerformanceTiming) 获取。首屏耗时对应的 DOM 元素，可以通过打印 aegis.firstScreenInfo 查看。如果 DOM 元素不能代表首屏，可以添加属性`<div aegis-first-screen-timing></div>`，把某个元素识别为首屏关键元素，SDK 认为只要用户首屏出现此元素就是首屏完成。也可以添加属性`<div aegis-ignore-first-screen-timing></div>`，把该 DOM 列入黑名单。

   根据以上数据，前端性能监控为用户绘制了页面加载瀑布图：

   ![](https://qcloudimg.tencent-cloud.cn/image/document/3826ce7ce5e32d309ca87f49db26fbac.png)

   > **说明：**
   >
   > - 总体来说，页面首屏和页面完全加载时间是正相关的。大多数情况下，用户的首屏时间是小于页面完全加载的。Aegis SDK 根据用户页面 DOM 变化计算首屏时间，如果用户页面完全加载后，还继续发生 DOM 变化，就有可能发生首屏时间晚于页面完全加载的情况。
   > - 在服务端场景，瀑布图会出现首屏时间大于 DOM 解析的情况，这是由于移动端设备兼容性问题，有些设备无法获取到 DNS 查询、TCP 连接、SSL 建连时间，这三个指标汇总后的平均值偏小，导致除了首屏时间外的其他指标都往左偏移。
   > - 如果用户发现 RUM 性能数据里面首屏耗时大于页面完成加载的问题，并且上报的 performance 接口中 firstScreenTiming 为 0 还有可能是 SDK 初始化时间太晚导致的，如果 SDK 初始化时，页面首屏已完成，则无法获取到正常的 firstScreenTiming 的值。建议用户把 SDK 初始化放在 head 中进行，尽早初始化，然后再确认上报数据是否正常。

## 接口测速

> **说明：**
>
> 打开方式：初始化时传入配置 `reportApiSpeed: true`

Aegis 通过劫持 `XHR` 及 `fetch` 进行接口测速。

## 资源测速

> **说明：**
>
> 打开方式：初始化时传入配置 `reportAssetSpeed: true`

Aegis 通过浏览器提供的 `PerformanceResourceTiming` 进行资源测速。

## 卡顿监控

> **说明：**
>
> 打开方式： 初始化时传入配置 `lagMonitor: { enabled: true }`

Aegis 卡顿监控基于浏览器的 `PerformanceObserver API` 和 `long-animation-frame` 类型，能够精准检测页面中的长任务和无响应事件。

#### 监控类型

| 类型       | 默认阈值 | 说明                               |
| ---------- | -------- | ---------------------------------- |
| 卡顿事件   | 2-5秒    | 检测超过阈值的长任务，影响用户体验 |
| 无响应事件 | 大于5秒  | 检测严重的页面阻塞，用户无法操作   |

开启卡顿监控功能后，可以在 [页面性能](https://console.cloud.tencent.com/monitor/rum/performance) 页面中看到卡顿率指标：

![](https://qcloudimg.tencent-cloud.cn/image/document/3d8c7e7006b14fab82df72491a790be4.png)

同时，日志页面中也可以看到对应的卡顿事件进行分析：

![](https://qcloudimg.tencent-cloud.cn/image/document/82f4f878c82c7170745af38a8362e5c9.png)

> **说明：**
>
> 卡顿事件中的 sourceURL 和 invoker 字段可能显示为 unknown，这是由于浏览器 API 的限制，非 SDK 问题。
>
> - 有归因信息的情况：
> - 事件处理器：`invoker: BUTTON.onclick`
> - 定时器回调：`invoker: TimerHandler:setTimeout`
> - 命名函数调用
> - 无归因信息的情况：
> - 页面初始加载时的脚本
> - 全局作用域直接执行的代码
> - 跨域脚本和 Web Workers
> - 浏览器扩展代码

### 配置项说明

卡顿监控所有配置项说明如下：

```typescript
export interface LagMonitorConfig {
  // 是否启用卡顿监控
  enabled?: boolean
  // 卡顿阈值，单位ms，默认2000ms
  threshold?: number
  // 无响应阈值，单位ms，默认5000ms
  noResponseThreshold?: number
}
```

使用示例：

```typescript
const aegis = new Aegis({
  id: 'your-project-id',
  lagMonitor: {
    enabled: true,
    threshold: 2000, // 默认阈值
    noResponseThreshold: 5000, // 关注严重阻塞
  },
})
```

## 内存监控

> **说明：**
>
> 打开方式： 初始化时传入配置 `memoryMonitor: { enabled: true }`

内存监控插件用于监控 Web 页面的 JavaScript 内存使用情况，支持定时上报和 OOM（内存溢出）检测。

内存监控所有配置项说明如下：

```typescript
export interface MemoryMonitorConfig {
  // 是否启用内存监控
  enabled?: boolean
  // 是否启用内存定时上报，默认 true
  enableMemoryReport?: boolean
  // 是否启用 OOM 检测上报，默认 true
  enableOOMReport?: boolean
  // OOM 阈值，单位MB，默认为设备内存上限的90%
  oomThreshold?: number
  // 内存定时上报间隔，单位ms，默认60000ms（1分钟）
  memoryReportInterval?: number
  // OOM 检测间隔，单位ms，默认10000ms（10秒）
  oomCheckInterval?: number
}
```

使用示例：

```typescript
const aegis = new Aegis({
  id: 'your-project-id',
  memoryMonitor: {
    enabled: true,
    enableMemoryReport: true, //  开启定时上报
    enableOOMReport: true, // 只开启 OOM 检测
    oomThreshold: 2000, // 自定义阈值2000MB
    oomCheckInterval: 10000, // 每10秒检测一次
  },
})
```

# 环境控制.md

aegis 默认把数据所在环境当作 `production` 进行上报，如果需自行修改，可以使用 env 参数进行修改。

```javascript
new Aegis({
  id: 'pGUVFTCZyewhxxxxxx',
  env: Aegis.environment.gray,
})
```

Aegis.environment 枚举值如下：

```javascript
export enum Environment {
  production = 'production', // 生产环境
  development = 'development', // 开发环境
  gray = 'gray', // 灰度环境
  pre = 'pre', // 预发布环境
  daily = 'daily', // 日发布环境
  local = 'local', // 本地环境
  test = 'test', // 测试环境
  others = 'others' // 其他环境
}
```

修改 env 参数后，aegis 上报的数据都会带上该参数，方便开发者区分不同环境的数据，但是只有 production 环境的数据会参与应用得分的计算。

# 配置文档.md

## 配置说明

配置文档各配置项说明如下：
<table>
<tr>
<td rowspan="1" colspan="1" >配置</td>

<td rowspan="1" colspan="1" >描述</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >id</td>

<td rowspan="1" colspan="1" >必须，string，默认无。<br>前端性能监控分配的应用 ID。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >uin</td>

<td rowspan="1" colspan="1" >建议，string，默认取 cookie 中的 UIN 字段。<br>当前用户的唯一标识符，白名单上报时将根据该字段判定用户是否在白名单中，字段仅支持<code>字母数字@=._-</code>，正则表达式：<code>/^[@=.0-9a-zA-Z_-]{1,60}$/</code>。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >reportApiSpeed</td>

<td rowspan="1" colspan="1" >可选，boolean 或者<a href="https://cloud.tencent.com/document/product/248/87197#reportapispeed.urlhandler.5B.5D(id.3Aexp2)"> object</a>，默认 false。<br>是否开启接口测速，这个开关设置为 true 后，还需在 <a href="https://console.cloud.tencent.com/monitor/rum/manage?currentTab=whitelist">白名单管理</a> 页面将用户添加为白名单用户，才会将采集到的正常的 api 请求记录到日志中，否则仅在指标分析模块聚合消费。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >reportAssetSpeed</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否开启静态资源测速。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >pagePerformance</td>

<td rowspan="1" colspan="1" >可选，boolean 或者 <a href="https://cloud.tencent.com/document/product/248/87197#pageperformance.urlhandler.5B.5D(id.3Aexp3)">object</a>，默认 true。<br>是否开启页面测速。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >webVitals</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 true。<br>是否开启 web vitals 测速。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >blankScreen</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否开启白屏监控。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >consoleLog</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否将采集的 console 日志上报为日志。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >clickElementLog</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否将采集的点击事件上报为日志。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ignoreElements</td>

<td rowspan="1" colspan="1" >可选，{"ignoreClasses": string[], "ignoreIds": string[]}，<br>例如 { "ignoreClasses": ["address-box","school-box"], "ignoreIds": ["phone-num-card","name-card"]},<br>通过元素的 class 和 id 忽略指定元素，用于过滤掉不需要上报的元素，例如用户的个人信息输入框等。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >slowApiLog</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否将采集的慢 api 请求数据上报为日志，慢的标准是请求耗时超过1000ms。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >pageLoadLog</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否将采集的正常页面加载数据上报为日志。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >slowPageLoadLog</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否将采集的慢页面加载数据上报为日志，慢的标准是 fmp 超过1000ms。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >assetLog</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否将采集的正常资源请求数据上报为日志，这个开关设置为 true 后，还需在 <a href="https://console.cloud.tencent.com/monitor/rum/manage?currentTab=whitelist">白名单管理</a> 页面将用户添加为白名单用户，才会将采集到的正常的资源请求记录到日志中，否则仅在指标分析模块聚合消费。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >slowAssetLog</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。<br>是否将采集的慢资源请求数据上报为日志，慢的标准是请求耗时超过1000ms。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >onError</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 true。<br>当前实例是否需要进行错误监听，获取错误日志。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >aid</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 true。<br>当前实例是否生成 aid。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >random</td>

<td rowspan="1" colspan="1" >可选，number，默认 1。<br>0 - 1 抽样率。 0 表示全部不上报。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >spa</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。 <br>当前页面是否为单页应用，若为 true，则将监听 hashchange 及 history api，在页面跳转时进行 PV 上报。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >pageUrl</td>

<td rowspan="1" colspan="1" >可选。默认是 location.href。 <br>修改上报数据中页面地址，开发者可以主动对数据进行聚合和降低维度。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >version</td>

<td rowspan="1" colspan="1" >可选，string，默认 SDK 版本号。<br>当前上报版本，当页面使用了 pwa 或者存在离线包时，可用来判断当前的上报是来自哪一个版本的代码，仅支持<code>字母数字.,:_-</code>，长度在 60 位以内 <code>/^[0-9a-zA-Z.,:_-]{1,60}$/</code>。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >delay</td>

<td rowspan="1" colspan="1" >可选，number，默认 1000ms。<br>上报节流时间，在该时间段内的上报将会合并到一个上报请求中。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >repeat</td>

<td rowspan="1" colspan="1" >可选，number，默认 5。<br>重复上报次数，对于同一个错误超过多少次后不上报。同一个接口上报测速数据的次数。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >env</td>

<td rowspan="1" colspan="1" >可选 enum，默认 Aegis.environment.production。当前应用运行所处的环境，详情请参见说明文档 <a href="https://cloud.tencent.com/document/product/248/87195">环境控制</a>。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >websocketHack</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 false。 <br>是否开启 websocket 监控。开启该选项后，将会对 websocket 连接断开状态进行监控，但是新建操作仍需要自定义监控。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >api</td>

<td rowspan="1" colspan="1" >可选，object，默认为 <code>{}</code>。相关的配置：<br>- apiDetail：可选，boolean，默认false。上报 api 信息的时候，是否上报 api 的请求参数和返回值。<br>- retCodeHandler：<code>Function(data: String, url: String, xhr: Object):{isErr: boolean, code: string}</code>， 返回码上报钩子函数。 会传入接口返回数据，请求 url 和 xhr 对象；详情请参见示例 <a href="https://cloud.tencent.cn/document/product/248/87197#api.retcodehandler.5B.5D(id.3Aexp1)">api.retCodeHandler</a>。<br>- reqParamHandler：Function(data: any, url: String) 上报请求参数的处理函数，可以对接口的请求参数进行处理，方便用户过滤上报请求参数的信息。<br>- resBodyHandler：Function(data: any, url: String) 上报 response 返回 body 的处理函数，可以对接口返回值的 response body 进行处理，只上报关键信息。<br>- resourceTypeHandler：Function，请求资源类型修正钩子函数会传入接口 url，返回值为<code>static</code>或 <code>fetch</code>。<br>- reportRequest：boolean，默认：false。开启后，aegis.info 会变成全量上报，不需要白名单配置，并且会上报所有接口的信息（上报接口需开启 reportApiSpeed）。<br>- reqHeaders：Array 需要上报的 HTTP 请求 request headers 列表。<br>- resHeaders：Array 需要上报的 HTTP 请求 response headers 列表。如果开发者需要获取的字段非 “simple response header”，需要在返回头中给字段添加 Access-Control-Expose-Headers。<br>- usePerformanceTiming：boolean，默认：false。aegis sdk 默认使用打点的方式计算接口耗时，该方式在移动端存在一些误差，开启 usePerformanceTiming 后，aegis sdk 会从 performance 中重新获取接口耗时，让接口耗时统计更为准确。需要注意的是，开启该参数的前提是用户业务接口请求 url 是独立且唯一的，用户可以在接口请求 url 中添加时间戳等方式来保证 url 唯一性。如果 url 不唯一，可能导致同 url 接口耗时获取错误。<br>- injectTraceHeader：可选，string，且必须为枚举值 'traceparent'、'sw8'、'b3'、'sentry-trace' 中的一种，开启该参数后，Aegis 会在用户请求头中注入相关 trace header。详细用法参考 <a href="https://cloud.tencent.com/document/product/248/98078">腾讯云可观测平台全链路接入</a>。<br>- injectTraceUrls：可选，Array，数组中传入 string 或者 RegExp。标记哪些请求 url 需要注入 trace 请求头。<br>- injectTraceIgnoreUrls：可选，Array，数组中传入 string 或者 RegExp。标记哪些请求 url 不需要注入 trace 请求头。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >lagMonitor</td>

<td rowspan="1" colspan="1" >可选，object，默认为 {}。相关配置如下：<br>- enabled：boolean，默认为 false。如果需要开启卡顿监控，设置为 true。<br>- threshold：可选，number，默认为2000。卡顿阈值，单位为毫秒。<br>- noResponseThreshold：可选，number，默认为5000。无响应阈值，单位为毫秒。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >memoryMonitor</td>

<td rowspan="1" colspan="1" >可选，object，默认为 {}。相关配置如下：<br>- enabled：boolean，默认为 false。如果需要开启内存监控，设置为 true。<br>- enableMemoryReport：boolean，默认为 true。是否启用定时上报内存值功能，如果仅需 OOM 检测，设置为 false。<br>- enableOOMReport：boolean，默认为 true。是否启用 OOM 检测，如果仅需定时内存上报，设置为 false。<br>- oomThreshold：number，默认为内存上限的90%。OOM 阈值，单位为MB。<br>- memoryReportInterval：number，默认60000。内存上报间隔，单位毫秒。<br>- oomCheckInterval：number，默认10000。OOM 检测间隔，单位为毫秒。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >speedSample</td>

<td rowspan="1" colspan="1" >可选，boolean，默认 true。<br>测速日志是否抽样（限制每条 url 只上报一次测速日志）。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext1</td>

<td rowspan="3" colspan="1" >可选，string，自定义上报的额外维度，上报的时候可以被覆盖，长度限制为1024，超过1024时会被截断。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext2</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext3</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext4</td>

<td rowspan="7" colspan="1" >可选，string，自定义上报的额外维度。如您需要使用 ext4 - ext10的扩展字段，您还需要在 <a href="https://console.cloud.tencent.com/monitor/rum/manage?region=ap-guangzhou&currentTab=ext-manage">前端性能监控 > 应用管理 > 字段映射配置</a> 模块上传<strong>自定义字段枚举表，</strong>以确保 ext4 - ext10的内容展示为您预期的效果。上报的内容如果<strong>不在自定义字段枚举表内</strong>，<strong>会被改写为 undefined</strong>。如果自定义事件、日志上报时包含 ext4 - ext10字段，会覆盖全局的配置上报。</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext5</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext6</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext7</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext8</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext9</td>
</tr>

<tr>
<td rowspan="1" colspan="1" >ext10</td>
</tr>
</table>

## 示例

### api.retCodeHandler

假如后台返回数据为：

```javascript
{
   body: {
      code: 200,
      retCode: 0,
      data: {
          // xxx
      }
   }
}

```

业务需要：code 不为200，或者 retCode 不为0，此次请求就是错误的。此时只需进行以下配置：

```javascript
new Aegis({
  // xxx
  reportApiSpeed: true, // 需要开两个，不然不会有返回码上报
  reportAssetSpeed: true,
  api: {
    retCodeHandler(data, url, xhr) {
      // data 是string类型，如果需要对象需要手动parse下
      // url 为请求url
      // xhr 响应,可以通过xhr.response拿到完整的后台响应
      try {
        data = JSON.parse(data)
      } catch (e) {}
      return {
        // isErr 如果是 true 的话，会上报一条 retcode 异常的日志。
        isErr: data.body.code !== 200 || data.body.retCode !== 0,
        code: data.body.code,
      }
    },
  },
})
```

### api.resourceTypeHandler

假如接口为：`http://example.com/test-api` 。返回的 `Content-Type` 为 `text/html`，这将导致 Aegis 认为该接口返回的是静态资源，可以通过以下方法修正：

```javascript
new Aegis({
  reportApiSpeed: true, // 需要开两个，不然不会有返回码上报
  reportAssetSpeed: true,
  api: {
    resourceTypeHandler(url) {
      if (url?.indexOf('http://example.com/test-api') != -1) {
        return 'fetch'
      }
    },
  },
})
```

### reportApiSpeed.urlHandler

假如您页面中有 restful 风格的接口，例如：

`www.example.com/user/1000`

`www.example.com/user/1001`

在上报测速时需要将这些接口聚合：

```javascript
new Aegis({
  // xxx
  reportApiSpeed: {
    urlHandler(url, payload) {
      if (/www\.example\.com\/user\/\d*/.test(url)) {
        return 'www.example.com/user/:id'
      }
      return url
    },
  },
  // xxx
})
```

### pagePerformance.urlHandler

假如您的页面 URL 是 restful 风格的，例如：

`www.example.com/user/1000`

`www.example.com/user/1001`

在上报页面测速时需要将这些页面地址聚合：

```javascript
new Aegis({
  // xxx
  pagePerformance: {
    urlHandler() {
      if (/www\.example\.com\/user\/\d*/.test(window.location.href)) {
        return 'www.example.com/user/:id'
      }
    },
  },
  // xxx
})
```

# 浏览器指纹.md

Aegis 指纹版 SDK 使用浏览器指纹算法作为用户唯一标识 aid，提升 uv 准确率；用户通过引用指纹版 Aegis SDK 即可使用该功能。

## 引入步骤

1. 引入指纹版 SDK。

- cdn 引入：

  ```html
  <script src="https://tam.cdn-go.cn/aegis-sdk/latest/aegis.f.min.js"></script>
  ```

- npm 引入：

  ```sh
  $ npm install aegis-web-sdk
  ```

  ```javascript
  import Aegis from '@tencent/aegis-web-sdk/lib/aegis.f.min'
  ```

  > **说明：**
  >
  > SDK version 需要大于 1.38.56 版本。

2. 登录 [腾讯云可观测 > 前端性能监控控制台](https://console.cloud.tencent.com/monitor/rum)，在左侧菜单栏选择**页面访问**，即可查看 UV。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/22585a2063de36c1a25fd664fbac3a06.png)

## 更多应用场景说明

与此同时，配合业务场景进行技术赋能，可以扩展出更多能力。例如安全部门基于指纹 SDK 扩展出安全审计功能等。

# Aegis SDK 支持获取请求头和返回头.md

通过记录自定义请求头和响应头的方式，打通前后端链路。

> **说明：**
>
> 目前仅支持 aegis-web-sdk 和 aegis-mp-sdk。

## 操作步骤

### 获取 Response Headers

假设有一个接口 `https://aegis.qq.com/generateOrderInfo`，该接口的有一个自定义的 Response Header `x-request-id`，值是 `monitor`，为前后端打通的唯一标识。

![](https://qcloudimg.tencent-cloud.cn/image/document/08d16caa326824090c5a34a8a2511189.png)

假设需要通过记录这个值到 RUM 来打通前后端的链路，实践步骤如下：

1. 将 SDK 升级到最新版本。

2. 修改初始化 SDK 的方式。

   ```javascript
   new Aegis({
     id: 'xxx',
     reportApiSpeed: true,
     api: {
       apiDetail: true, // 上报接口请求参数和返回值
       reportRequest: true, // 全量接口上报
       reqHeaders: ['sw8'], // 记录 request header
       resHeaders: ['x-request-id', 'Content-Type', 'server'], // 记录 response header
     },
   })
   ```

    3. 暴露 unsafe header。

   完成步骤1和步骤2后，会发现 `Content-Type` 赋值了，但是 `x-request-id` 和 `server` 还是没有赋值。

   此时使用 xhr.getResponseHeader() 去获取相关 header，会发现并没有获取值，而且浏览器会出现报错信息。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/378c883fe1c8620d5ccf7fb05deaa9a9.png)

   > **说明：**
   >
   > 具体报错原因可参见 [相关文档](https://cloud.tencent.com/developer/article/1060305)。

   此时需要暴露 unsafe header，给要需要上报的接口加上 Access-Control-Expose-Headers，如下所示：

   ```javascript
      location /generateOrderInfo {
           add_header Access-Control-Allow-Origin *;
           add_header Access-Control-Allow-Headers 'sw8';
           add_header Access-Control-Expose-Headers 'x-request-id, server';
           proxy_pass http://9.139.xx.xx:9301/generateOrderInfo;
       }
   ```

   上报效果如下：

   ![](https://qcloudimg.tencent-cloud.cn/image/document/078bfd6cc560b6132abf865ae0f3c8f4.png)

### 获取 Request Headers

获取 request headers 的使用方式与获取 response headers 的方式大致相同，只需要在初始化的时候传入需要标记的 header 即可获取。

```javascript
new Aegis({
  id: 'xxx',
  reportApiSpeed: true,
  api: {
    apiDetail: true, // 上报接口请求参数和返回值
    reportRequest: true, // 全量接口上报
    reqHeaders: ['sw8'], // 记录 request header
  },
})
```

获取 request header 不会有浏览器的安全限制，添加较为方便。

添加后若接口请求中有 request header，即可在日志中看到相关数据。

![](https://qcloudimg.tencent-cloud.cn/image/document/90534d7da9a5dacca3dc13842bffe0b4.png)

### 自动获取 trace header

目前 aegis sdk 已经实现自动解析 opentelemetry、skywalking、sentry 等 trace 协议的 header，并且自动进行上报，如果用户同时接入具有 trace 能力的 sdk，可以实现 traceid 自动识别功能。

![](https://qcloudimg.tencent-cloud.cn/image/document/c248e4c158a03251bb613423f02bf4db.png)

### 跨域问题

如果接口添加了自定义 header，会导致接口请求跨域，需要对接口进行处理才能上报。例如：下列例子中需在项目的请求添加 `sw8`，在 nginx 中的配置添加 Access-Control-Allow-Headers。

```html
location /generateOrderInfo { add_header Access-Control-Allow-Origin *; add_header
Access-Control-Allow-Headers 'sw8'; add_header Access-Control-Expose-Headers 'x-request-id, server';
proxy_pass http://9.139.xx.xx:9301/generateOrderInfo; }
```

## 常见问题

### 什么情况下会用到记录请求 request header ？

例如您通过随机 key 给请求添加标记，作为 traceid 的情况；或者您接入除了 aegis 以外的第三方监控 SDK。

具体使用 skywalking 打通前后端的方式可参见 [前后端链路打通](https://cloud.tencent.com/document/product/248/87108)。

结合记录请求 request header，并通过 skywalking 打通前端和后端 API 调用链路后，即可在 RUM 上查看相关前端请求信息、前端请求错误信息和前端性能数据等。

# OpenTelemetry 前后链路打通.md

腾讯云前端性能监控可联动腾讯云应用性能监控实现前后端一体化监控。本文将以 RUM 和 APM 全链路接入为例，简单介绍如何快速高效改造用户现有的业务，并且通过前后端 trace 打通的案例，实现调用链路追踪，帮助用户解决开发和排障中的实际问题。

## 背景

### **业务系统日益复杂**

随着互联网产品的快速发展，不断变化的商业环境和用户诉求带来了纷繁复杂的业务需求。业务系统需要支撑的业务场景越来越广、涵盖的业务逻辑越来越多，系统的复杂度也跟着快速提升。与此同时，由于微服务架构的演进，业务逻辑的实现通常需要依赖多个服务间的共同协作。总而言之，业务系统的日益复杂已经成为一种常态。

### **业务追踪面临挑战**

业务系统往往面临着多样的日常客诉和突发问题，“业务追踪”就成为了关键的应对手段。业务追踪可以看做一次业务执行的现场还原过程，通过执行中的各种记录还原出原始现场，可用于业务逻辑执行情况的分析和问题的定位，是整个系统建设中重要的一环。

> **说明：**
>
> 目前建议前后端均使用 OpenTelemetry 协议的上报方式。

## 步骤1：接入 RUM SDK

1. 登录 [腾讯云可观测平台](https://console.cloud.tencent.com/monitor)。

2. 在左侧菜单栏中单击**前端性能监控** > **数据总览**。

3. 在数据总览页中单击**应用接入**，根据提示填写配置信息。

4. 配置完后单击**下一步**，进入应用接入页面。根据页面提示接入 RUM SDK，并初始化 SDK。

5. 开启下图对应配置参数，前端方面即已完成链路配置。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/6f789ba6a9a4394c8dc375edcb7a91c9.png)

   > **说明：**
   >
   > reqHeaders 需要上报的 HTTP 请求 request header 列表参数，一般与 injectTraceHeader 参数值保持一致。详细接入步骤可参见 [应用接入](https://cloud.tencent.cn/document/product/248/87220)。

### 关键配置

字段 injectTraceHeader 会使 Aegis SDK 给所有监控的接口注入对应的请求头，并且自动生成相关协议字段。目前支持 traceparent、sw8、b3、sentry-trace。

| 协议         | 说明                                 |
| ------------ | ------------------------------------ |
| traceparent  | OpenTelemetry 的协议字段（推荐使用） |
| sw8          | SkyWalking 的协议字段                |
| b3           | Zipkin 跟踪协议字段                  |
| sentry-trace | Sentry 的协议字段                    |

## 步骤2：后端使用 OpenTelemetry 方式接入 APM

1. 在 [应用性能监控 > 资源管理 > 资源总览](https://console.cloud.tencent.com/monitor/apm/team) 页面，单击**新建**，创建业务系统。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/dce02c93717925506832a8c26e8ae9fc.png)

2. 进入 [应用监控](https://console.cloud.tencent.com/monitor/apm/system?access=1) 页面接入应用，选择对应的业务系统，选择对应的语言和 OpenTelemetry 方式接入应用。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/58b669a9d1957ee3e142af171b7e91ad.png)

   > **说明：**
   >
   > 目前支持 Java 、Go、Python、Node、PHP 应用接入方式，详细请参见 [应用性能监控 > 接入指南](https://cloud.tencent.com/document/product/248/87124)。

## 步骤3：使用方法

当接口发生请求，产生历史日志时，您在 [前端性能监控 > 日志查询 > 历史日志](https://console.cloud.tencent.com/monitor/rum/log) 可以选择字段 Trace，若该日志有 TraceID，可左键单击 TraceID。在弹框中单击**自定义跳转**配置，绑定 APM 业务系统。

![](https://qcloudimg.tencent-cloud.cn/image/document/a3bffedee9c891348e3955e78fee5382.png)

绑定后，单击相关链接即可跳转到 APM 链路详情页，查看该条请求在整个链路下的状态。

![](https://qcloudimg.tencent-cloud.cn/image/document/55dceceda6f44344887afa20d6898143.png)

实现调用链路追踪，排查后端链路异常原因，快速定位异常信息。

![](https://qcloudimg.tencent-cloud.cn/image/document/f344afc57bb99cf54c54e6cf881944c6.png)

## 全链路打通方案

### Trace 是如何打通的

接入 OpenTelemetry 后所有打桩的接口都会带上一个请求头，traceparent 或者 b3，这个请求头是 trace 打通的核心，它主要由 traceId 和 spanId 组成，traceId 会跟随这个接口一直向下，所有的内部服务和请求都带有该字段，每层服务生成对应的 span，最后根据 traceId 把所有 span 连起来形成了 trace 数据链。

如果 Aegis SDK 根据用户协议生成对应的 trace 关键字，并且带入到请求的 header 中，发现也可以实现这个效果：我们在项目验证中，去掉了所有 OpenTelemetry 的引入，然后 Aegis SDK 中 mock 了一个 traceparent，发现上报正常，trace 也可以正常生成。

![](https://qcloudimg.tencent-cloud.cn/image/document/d5701e485ab8fce8947074c1a92a2676.png)

不过对比这个 trace 的图发现这里 trace 起点是 tomcat，不是前端的 HTTP 请求，所以可以判断这里是缺少了 前端的 span。

因为没有在前端接入 OpenTelemetry 的 sdk，所以这里也不难理解为什么 trace 中少了前端的 span 了。

那么如果用户可以接受忽略 trace 缺少前端 span 这种情况，其实当前的方案已经可以满足 90% 的问题查询 case 了，缺点可能就是如果请求链路在网络层或者 CLB 层断掉的话，就没办法发现断掉的原因。除此之外，前端的数据可以在 RUM 上看，后端的链路可以在 APM 上查看。

于是我们对当前 Aegis SDK 进行优化，可以适配不同全链路协议的请求头。

目前适配的协议有：[traceparent](https://www.w3.org/TR/trace-context/)、[b3](https://github.com/openzipkin/b3-propagation)、[sw8](https://skywalking.apache.org/docs/main/next/en/api/x-process-propagation-headers-v3/)、[sentry-trace](https://develop.sentry.dev/#trace-header)，根据下游应用选择对应的协议。

### SDK 全新接入方案

通过 injectTraceHeader 参数，Aegis SDK 会给所有监控的接口注入对应的请求头，并且自动生成相关协议字段。

对比之前需要几十行的接入代码，并且需要非常复杂的 Nginx 转发配置，当前方案极大的减少了开发者的使用负担。从性能的角度来看，当前方案上报的数据量也远远少于之前的方案，开发者也不需要详细理解 trace 协议的原理，只需要配置即可，可以说是比较方便地实现了“无侵入接入”。

```plaintext
import Aegis from 'aegis-web-sdk'; // 或者通过 cdn 的方式引入

new Aegis({
    id: 'xxxxxx',
    api: {
        injectTraceHeader: 'traceparent', // 注意这里目前支持 traceparent，b3，sw8，sentry-trace
        injectTraceIgnoreUrls: ['/v1/traces', /rumt-zh.com/], // 忽略不参与注入的接口
    },
});
```

## 常见问题

### 前端接口请求头跨域？

![](https://qcloudimg.tencent-cloud.cn/image/document/479e0d37a9006a02597079c2c3a5897f.png)

部分接口具有严格跨域限制，不允许在 header 中添加额外参数，Traceparent 的注入会导致其跨域。可以使用如下两种方式解决：

- 采用 injectTraceIgnoreUrls: Array，数组中传入 string 或者 RegExp。标记不需要注入 trace 请求头的请求 url 。

- 采用 injectTraceUrls: Array，数组中传入 string 或者 RegExp。标记需要注入 trace 请求头的请求 url 进行全链路追踪。（推荐）

  推荐原因： 用户侧请求环境复杂，采用 injectTraceIgnoreUrls 则需要枚举出全部当前项目关联的 ignore request，恐有遗漏。采用 injectTraceUrls 方式，则链路 request 请求的主动权在用户侧，可灵活配置。

  ![](https://qcloudimg.tencent-cloud.cn/image/document/584247ca6b9f10cfbef61f318a1d0830.png)

### 验证 RUM 和 APM 是否上报正常

**验证 RUM 是否上报成功**

1. 首先，可以在浏览器控制台看到您的业务接口Request headers中存在对应协议参数 ，例如 Traceparent。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/b9c57a8946620a288f964c493c092e6b.png)

2. 其次在 [页面性能](https://console.cloud.tencent.com/monitor/rum/performance?PID=120000&condition%5Bfrom%5D=&from=&requestTime=1716457053198) 中查看是否有数据显示，若有数据上报则表示上报成功。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/ab9c59bc8bd5c0b4126fb33861c89df8.png)

   **验证 APM 是否上报成功**

   在 [资源管理页面](https://console.cloud.tencent.com/monitor/apm/team?rid=1) 查看是否有数据上报量，若有数据上报则表示上报成功。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/841b7ba3d702a17419dc14ca8aedf40d.png)

# RUM 自动上传 sourcemap 文件.md

Sourcemap 文件对于前端 JS 排障至关重要。Sourcemap 是一个信息文件，里面储存着代码转换前后的对应位置信息，可以解决在打包过程中，代码经过压缩、去空格以及 babel 编译转化后，由于代码之间差异性过大，造成无法 debug 的问题。Sourcemap 文件通常是在 CI/CD 过程中自动生成，如果用户有需求通过 API 调用或者想通过自定义流水线插件使流程自动化，可以参考以下的上传流程。

### 步骤1：获取调用云 API 的密钥

针对云上产品，前端页面使用的接口和 API 开放平台的接口是一致的。前端页面鉴权方式通常是使用微信/QQ/云梯账号等，而 API 开放平台的鉴权方式需要通过调用 API 对账号以及账号密钥进行鉴权。如果您想了解更多关于云 API 的内容，可以通过 [前端性能 API 3.0 版本](https://cloud.tencent.com/document/product/1464/59467) 进行查看。

### 步骤2：按照 demo 进行改造

为便于您的使用，您可以参照以下代码进行编写，以此改造自己的插件：

```javascript
// Depends on tencentcloud-sdk-nodejs version 4.0.3 or higher
// 需要引入相关 npm 包
const tencentcloud = require('tencentcloud-sdk-nodejs')
const COS = require('cos-nodejs-sdk-v5')
const fs = require('fs')
var crypto = require('crypto')
const RumClient = tencentcloud.rum.v20210622.Client
const clientConfig = {
  credential: {
    secretId: '子账号密钥 id',
    secretKey: '子账号密钥 key',
  },
  region: '',
  profile: {
    httpProfile: {
      endpoint: 'rum.tencentcloudapi.com', // rum.tencentcloudapi.com 是外网域名，如果上面的密钥对没有开外网访问，使用外网域名将报无权限错误
    },
  },
}
const client = new RumClient(clientConfig)
const params = {}
const projectID = 0 // rum 的项目 id（数字 id 不是上报 key）
const version = '1.0.0' // 这里自己填入需要的版本号(比如线上使用的 js 是1.0.0版本)
const fileName = 'test.js.map' // sourcemap 文件名
// 读取文件内容
const sourceMapFileContent = fs.readFileSync('./test.js.map')
var fileHash = crypto.createHash('md5').update(sourceMapFileContent.toString()).digest('hex')
const cos = new COS({
  getAuthorization: (options, callback) => {
    client
      .DescribeReleaseFileSign(params)
      .then(
        (data) => {
          callback({
            TmpSecretId: data.SecretID,
            TmpSecretKey: data.SecretKey,
            SecurityToken: data.SessionToken,
            ExpiredTime: data.ExpiredTime,
          })
        },
        (err) => {
          console.error('error', err)
        },
      )
      .catch((err) => {
        console.log(err)
      })
  },
})
const timestamp = +new Date()
const fileKey = `${projectID}-${version}-${timestamp}-${fileName}`
cos
  .putObject({
    Bucket: 'rumprod-1258344699' /* 必须 */, // 固定值
    Region: 'ap-guangzhou' /* 存储桶所在地域，必须字段 */, // 固定值
    Key: fileKey /* 必须 */,
    Body: sourceMapFileContent.toString(), // 上传文件对象
  })
  .then((res) => {
    console.log(res)
    client
      .CreateReleaseFile({
        ProjectID: projectID,
        Files: [
          {
            Version: version,
            FileKey: fileKey,
            FileName: fileName,
            FileHash: fileHash,
          },
        ],
      })
      .then(
        (data) => {
          console.log('CreateReleaseFile res:', data)
          client
            .DescribeReleaseFiles({
              ProjectID: projectID,
            })
            .then(
              (data) => {
                // 这里就能查看到自己上传的 sourcemap 文件列表了
                console.log('DescribeReleaseFiles res: ', data)
              },
              (err) => {
                console.error('DescribeReleaseFiles error', err)
              },
            )
        },
        (err) => {
          console.error('CreateReleaseFile error', err)
        },
      )
  })
  .catch((err) => {
    console.log('putObject err:', err)
  })
```

# 将 RUM 页面嵌入自建系统.md

RUM 满足不需要登录腾讯云控制台即可查询分析数据的诉求。通过内嵌前端性能监控控制台页面，可以给用户带来以下方便：

- 在外部系统服务中（例如公司内部运维或运营系统）快速集成 rum 数据的查询分析能力。

- 无需管理众多腾讯云子账号，方便将 RUM 数据分享给他人进行查看。

  ![](https://qcloudimg.tencent-cloud.cn/image/document/2adc6de4ff39121108b3b3d422205eb5.png)

## 创建用户身份

企业用户（运维或开发人员）根据业务需求申请对应的权限，用户身份对应腾讯云账号角色，可以通过 [控制台](https://console.cloud.tencent.com/cam/role) 或 [创建角色API](https://cloud.tencent.com/document/product/598/36225) 创建对应的角色：

### 通过控制台创建 CAM 角色

1. 登录 [访问管理 CAM 控制台](https://console.cloud.tencent.com/cam)。

2. 单击左侧菜单栏中的**角色**，进入角色页面。

3. 选择**新建角色 > 腾讯云账户**，开始新建自定义角色。

4. 选择**当前主账号**并勾选**允许当前角色服务控制台**，单击**下一步**。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/7b9ed29dfe7b095da795a1f40f65a589.png)

5. 为角色设置访问策略，例如只读策略权限 QcloudRUMReadOnlyAccess，单击**下一步。**

   ![](https://qcloudimg.tencent-cloud.cn/image/document/f1237c357c18fa49c243951aedca6ddf.png)

6. 为角色配置不同维度标签，使用标签对用户进行分类管理。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/b58c02ee867db5faf7f912f116e337f2.png)

7. 输入角色名，完成创建。

   ![](https://qcloudimg.tencent-cloud.cn/image/document/a102d5c85cc03d5f6ceaeeb56cd6e3f4.png)

### 通过 API 创建 CAM 角色

1. 获取当前用户的访问密钥，可参见 [主账号访问密钥管理](https://cloud.tencent.com/document/product/598/40488) 。

2. 创建角色，详情请参见[ 创建角色 API](https://cloud.tencent.com/document/product/598/36225) ，其中 ConsoleLogin 需要填入1，允许角色登录控制台。

3. 绑定 QcloudRUMReadOnlyAccess 的权限策略到角色，详情参见[ 绑定权限策略到角色](https://cloud.tencent.com/document/product/598/36226) 。

## 获取用户身份访问密钥

根据角色名访问腾讯云 STS 服务，调用 [AssumeRole](https://cloud.tencent.com/document/product/1312/48197) 接口，申请角色 CompanyOpsRole 的临时密钥。

> **注意：**
>
> 设置中可能存在以下风险，请参考安全意见进行操作：
>
> - 临时密钥有效期请勿设置过长，建议设置在 5 分钟以内，可通过 AssumeRole 参数 DurationSeconds 指定。
> - 包含参数的完整登录地址（https://cloud.tencent.com/login/roleAccessCallback?algorithm...）请勿暴露在公网。
> - 用户侧用于生成登录地址的系统需设置鉴权，例如内网身份校验，请勿设置成公开权限访问。

## 生成 APM 访问链接

### 生成签名串

1. 拼接参数。对要求签名的参数按照字母表或数字表递增顺序的排序，先考虑第一个字母，在相同的情况下考虑第二个字母，依此类推。

   | 参数名称  | 必选 | 类型   | 描述                          |
   | --------- | ---- | ------ | ----------------------------- |
   | action    | 是   | String | 操作动作，固定为 roleLogin    |
   | timestamp | 是   | Int    | 当前时间戳                    |
   | nonce     | 是   | Int    | 随机整数，取值10000-100000000 |
   | secretId  | 是   | String | STS 返回的临时 AK             |

   **拼凑参数示例：**`action=roleLogin&nonce=67439&secretId=AKI***PLE&timestamp=1484793352`

2. 拼接签名串。按`请求方法 + 请求主机 +请求路径 + ? + 请求字符串`的规则拼接签名串。

   | 参数           | 必选 | 描述                                              |
   | -------------- | ---- | ------------------------------------------------- |
   | 请求主机和路径 | 是   | 固定为 cloud.tencent.com/login/roleAccessCallback |
   | 请求方法       | 是   | 支持 GET 或 POST                                  |

   **拼接签名串示例：**`GETcloud.tencent.com/login/roleAccessCallback?action=roleLogin&nonce=67439&secretId=AKI***PLE&timestamp=1484793352`

3. 生成签名串。使用 HMAC-SHA1 算法对字符串签名，目前支持 HMAC-SHA1 和 HMAC-SHA256，以 Python 语言为例：

   ```python
   sts_secret_id = "AKI***PLE"
   sts_secret_key = "IF***Wn3"
   sig_str = 'GETcloud.tencent.com/login/roleAccessCallback?action=roleLogin&nonce=' + str(nonce) + '&secretId=' + sts_secret_id + '&timestamp=' + str(timestamp)
   sign_str = base64.b64encode(hmac.new(bytes(sts_secret_key, encoding='utf-8'), bytes(sig_str, encoding='utf-8'), hashlib.sha1).digest())
   ```

### 拼凑最终访问链接

1. 获取 RUM 控制台页面：https://console.cloud.tencent.com/monitor/rum?hideWidget=true&hideTopNav=true

   URL 参数说明：

   | 参数名称    | 必选 | 类型    | 描述                                                      |
   | ----------- | ---- | ------- | --------------------------------------------------------- |
   | hideWidget  | 否   | Boolean | 是否隐藏智能客服图标：默认不隐藏，true 表示隐藏           |
   | hideTopNav  | 否   | Boolean | 是否隐藏腾讯云控制台顶部导航栏：默认不隐藏，true 表示隐藏 |
   | hideLeftNav | 否   | Boolean | 是否隐藏腾讯云控制台左侧导航栏：默认不隐藏，true 表示隐藏 |

2. 拼接完整登录信息以及目的页地址进行登录，参数值需要 urlencode 编码。

   ```bash
   https://cloud.tencent.com/login/roleAccessCallback
   ?algorithm=<签名时加密算法，目前只支持 sha1 和 sha256 ，不填默认 sha1
   &secretId=<签名时 secretId>
   &token=<临时密钥 token>
   &nonce=<签名时 nonce>
   &timestamp=<签名时 timestamp>
   &signature=<签名串>
   &s_url=<登录后目的 URL>
   ```

3. 使用生成的最终链接，访问腾讯云 APM 控制台页面。

   ```bash

   ```

## 完整示例代码

Python 语言完整实例代码：

```python
import json
import random
import time
import base64
import hmac
import hashlib
from urllib.parse import quote
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.cam.v20190116 import cam_client, models as cam_models
from tencentcloud.sts.v20180813 import sts_client, models as sts_models

try:
    role = "CompanyOpsRole"
    uin = 100020507208

    # 步骤一：创建角色
    secret_id = "AK***NO"
    secret_key = "lG***Zx"
    cred = credential.Credential(secret_id, secret_key)
    httpProfile = HttpProfile()
    httpProfile.endpoint = "cam.tencentcloudapi.com"

    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    client = cam_client.CamClient(cred, "", clientProfile)

    # 步骤二：创建 CAM 角色
    req = cam_models.CreateRoleRequest()
    params = {
        "RoleName": role,
        "PolicyDocument": "{\"version\":\"2.0\",\"statement\":[{\"action\":\"name/sts:AssumeRole\",\"effect\":\"allow\",\"principal\":{\"qcs\":[\"qcs::cam::uin/" + str(
            uin) + ":root\"]}}]}",
        "ConsoleLogin": 1
    }
    req.from_json_string(json.dumps(params))
    client.CreateRole(req)

    # 步骤三：绑定权限策略到角色
    req = cam_models.AttachRolePolicyRequest()
    params = {
        "AttachRoleName": role,
        "PolicyName": "QcloudRUMReadOnlyAccess"
    }
    req.from_json_string(json.dumps(params))
    client.AttachRolePolicy(req)

    # 步骤四：请求 AssumeRole
    client = sts_client.StsClient(cred, "ap-shanghai")
    req = sts_models.AssumeRoleRequest()
    req.RoleArn = "qcs::cam::uin/" + str(uin) + ":roleName/" + role
    req.RoleSessionName = "test"
    resp = client.AssumeRole(req)

    # 步骤五：生成签名串
    sts_secret_id = resp.Credentials.TmpSecretId
    sts_secret_key = resp.Credentials.TmpSecretKey
    token = resp.Credentials.Token
    nonce = random.randint(10000, 100000000)
    timestamp = int(time.time())

    sig_str = 'GETcloud.tencent.com/login/roleAccessCallback?action=roleLogin&nonce=' + str(
        nonce) + '&secretId=' + sts_secret_id + '&timestamp=' + str(timestamp)
    sign_str = base64.b64encode(
        hmac.new(bytes(sts_secret_key, encoding='utf-8'), bytes(sig_str, encoding='utf-8'), hashlib.sha1).digest())

    # 步骤六：拼凑最终访问链接
    result = 'https://cloud.tencent.com/login/roleAccessCallback?algorithm=sha1&secretId=' + \
             quote(sts_secret_id) + '&token=' + quote(token) + '&nonce=' + str(nonce) + '&timestamp=' + str(
        timestamp) + '&signature=' + quote(sign_str) + \
             '&s_url=' + quote('https://console.cloud.tencent.com/monitor/rum?hideWidget=true&hideTopNav=true')
    print(result)
except TencentCloudSDKException as err:
    print(err)
```

# 产品相关问题.md

### RUM 是什么？

前端性能监控（Real User Monitoring，RUM）是一站式前端监控解决方案，专注于 Web 和小程序等大前端领域，主要关注用户页面性能（页面测速、接口测速、CDN 测速等）和质量（JS 错误、Ajax 错误等），并且联动腾讯云应用性能监控实现前后端一体化监控。用户只需要安装 SDK 到自己的项目中，通过简单配置化，即可实现对用户页面质量的全方位守护，真正做到了低成本使用和无侵入监控。可参考 [快速入门](https://cloud.tencent.com/document/product/248/87640)。

### Aegis SDK 的作用是什么？

Aegis SDK 是嵌入到用户页面或者使用 npm 安装到用户代码中的上报 SDK，主要负责采集用户侧性能和质量数据。

### RUM 和 Aegis SDK 有什么关系？

- RUM 是前端性能监控平台，Aegis 是前端监控 SDK，负责数据采集和上报。

- Aegis 是前端性能监控（RUM） 提供的监控 SDK，开发者将其代码嵌入到页面中，即可实现对页面性能和质量的监控。

  - [aegis-web-sdk](https://www.npmjs.com/package/aegis-web-sdk)：Web 页面监控 SDK

  - [aegis-mp-sdk](https://www.npmjs.com/package/aegis-mp-sdk)：小程序页面监控 SDK

### RUM 采集了哪些用户信息？

RUM 采集了哪些用户信息，可参考 [前端性能监控 SDK 隐私保护协议](https://cloud.tencent.com/document/product/248/87595)、[前端性能监控服务协议](https://cloud.tencent.com/document/product/301/62323)。

### 接入前端性能监控，用户的流量可能会很大，或者某个时间点要发活动，应该怎么做？

如果页面 QPS 超过 1w 或者上报 QPS 超过 2w，请提前联系 [腾讯云助手](https://cloud.tencent.com/document/product/248/59917#.E8.85.BE.E8.AE.AF.E4.BA.91.E5.8A.A9.E6.89.8B) 进行报备。

### 接入前端性能监控，对于境外用户使用和上报，性能是否有影响？CDN 和 上报是就近接入的吗？

CDN 目前在以下国家均有 OC 节点：英国、越南、日本、美国、新加坡、中国香港、韩国、泰国。上报数据的节点目前还没有在境外部署，会走中国香港的节点，然后把数据转存到境内。

> **说明：**
>
> - RUM 2022年6月正式上线新加坡节点，数据上报和存储节点都在新加坡。
> - RUM 2022年10月正式上线硅谷节点，数据上报和存储节点都在北美硅谷。

![](https://qcloudimg.tencent-cloud.cn/image/document/972185ba952ed50921d02d07d13d606f.png)

**具体使用方式：**

在 RUM 平台创建境外的业务系统，地域选择新加坡或者硅谷，然后在该业务系统下创建应用。应用接入的时候与境内上报域名不同，需要开发者改下 hostUrl 参数修改上报域名。具体上报域名如下：

- 境内、中国香港、中国澳门、中国台湾可以选择使用 https://rumt-zh.com/ 作为上报域名。

- 新加坡地区可以选择 https://rumt-sg.com/ 作为上报域名。

- 硅谷地区可以选择 https://rumt-us.com/ 作为上报域名。

  > **注意：**
  >
  > 不同上报域名对应不同数据存储和服务器部署区域，所以不能混报，例如使用境内节点的 RUM 应用上报 ID，向新加坡节点上报数据，就无法正常上报。

### RUM 支持私有化部署吗？

私有化方案目前在开发中，敬请期待。

### 用户的日志会保存多久？

- 用户上报的原始日志，包括错误、自定义上报、页面访问，会保留30天。

- 性能相关的指标数据，如页面性能，API 监控、静态资源监控等，会保留30天。

- RUM 每天定时计算得出来的数据，例如：每天的应用评分、每天的 PV/UV 汇总数据等，会保留90天。

### 前端性能监控目前支持了哪些平台？提供了什么平台的 SDK？

前端性能监控目前支持 Web、小程序（微信、QQ）、Hippy、Weex、React Native、 Flutter 和 Cocos 等平台的数据上报。

### RUM 的 uv 是否支持高维度数据，例如页面地址、ext、省市等？

aegis SDK 没有根据用户设置的 uin 来计算 uv，因为如果当前用户没有登录，则无法计算，而且 uin 值由开发者设置，并不完全可靠，还有无法将用户登录前后状态统一起来，因此 aegis sdk 为每个用户独立生成一个 aid 作为用户（设备）的唯一标识，并且存储在 localStorage 里面，不受登录状态影响。使用 aid 的缺点是如果用户清理了设备的 localstorage，aid 会重新生成一个，导致 uv 计算比实际高一点，但是清理设备 localStorage 是低频操作，因此我们认为可以接受。还有多个账号重复登录同一个设备的问题，按照正常的 uv 计算逻辑，应该算多个值的，但是我们只计算了一个值。aid 的计算算法如下：

```plaintext
async getAid(callback: Function) {
// 某些情况下操作 localStorage 会报错.
  try {
  let aid = await localStorage.getItem('AEGIS_ID');
  if (!aid) {
  aid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  localStorage.setItem('AEGIS_ID', aid);
  }
  callback?.(aid || '');
  } catch (e) {
  callback?.('');
  }
}
```

RUM 目前 uv 数据暂时不支持高维数据，原因在于 uv 计算是一个比较消耗资源的事情，而且需要提前预计算好，例如一个项目有 N 个页面，就需要提前把每个页面的 uv 计算出来，但是考虑到很多项目的页面都是高维的，所以会导致我们计算 uv 的压力非常大。如果再加上其他维度，例如省市、ext，相当于计算这些所有维度组合的笛卡尔积个数的计算任务，压力就更大了。

### 为什么有一段时间的 pv 有数据，uv 却没数据？

uv 会按天去重。假如有一个用户当天的早些时间访问过您的项目，uv 统计过了，当天再次访问就不计算 uv 了。

### RUM 告警支持哪些渠道？如何设置？

此问题可参考 [告警通知渠道](https://cloud.tencent.com/document/product/248/50410)。

### RUM 日报功能在哪里？

可以在 [报表管理](https://console.cloud.tencent.com/monitor/monitoring-report) 中新增日报。

# 技术排查相关文档.md

### 代码中 `throw new Error` Aegis SDK 没有捕获到，如何处理？

在 VUE 框架中，Vue.config.errorHandler 会主动捕获错误，可以通过主动捕获再调用 aegis.error() 进行上报。

### 接入 SDK 后没有数据是怎么回事？

没有数据可以从5个方向查问题：

1. 查看上报接口（aegis.qq.com）返回是否正常，正常返回200和204，如果接口返回403可以看下一个问题。

2. 看日志查询里面页面访问和历史是否有数据，如果没有数据，有可能是上报延迟导致（1-2min）。

3. 数据总览里面的数据是每整数小时计算一次，如果没有数据可以看下是否上个小时没有页面访问，或者新接入还没开始计算。

4. 如果是页面性能没有数据，或者缺少数据，可以看下 network 中上报接口 performance 中的 firstScreenTiming 的值，如果这个值为0，或者大于15s，就会导致页面性能缺少数据。

   解决办法：把 sdk 初始化尽可能放在代码最前面，可以考虑用 cdn 并且在 head 中初始化代码，尤其对于一些 SSR 的页面，因为页面首屏时间较小，初始化 sdk 过晚会导致无法采集到页面首屏信息。

5. 对于日志中没有数据，尤其刚刚接入的应用，因为 Aegis SDK 默认只采集错误日志，例如接口报错、js 错误、promise 错误等，所以刚刚接入会看不到日志。开发者可以主动上报一些日志（aegis.infoAll、aegis.report等），看是否有数据。如果有需要，也可以开启全量接口上报（api.reportRequest），查看上报的接口的信息。

### 前端监控里面统计到的接口耗时（静态资源耗时）跟后端统计的相差很远，可能是什么原因导致的？

1. 用户网络出问题，请求没有发生到后端，耗时比较久后失败了。

2. 用户请求发出了，但是中间网络层耗时比较久，后端处理很快，过了很久才返回给用户。

3. 用户看的是平均值，可能由于某个或者某几个用户出现比较高的异常值导致整体值偏低，用户可以看下中位数是否依然异常。

4. 用户请求接口（静态资源）受多方面因素影响，网络、地域、设备都会对最终值产生影响，cdn 没有预热，dns 第一次解析耗时比较久等原因都会导致前后端统计不一致，前端性能监控通过浏览器的 performance 对象获取这些耗时并且进行上报。

5. 前端性能监控只是把这个耗时记录下来，并不对这个耗时负责。

### 接口请求报错403要怎么处理？

接口403一般是因为页面域名校验失败导致的，您可以在 [前端性能监控 > 应用管理 > 应用设置](https://console.cloud.tencent.com/monitor/rum/manage) 中检查应用创建时候设置的域名跟实际上报的域名是否一致。如果应用不需要校验，域名可以填 `*`。
![](https://qcloudimg.tencent-cloud.cn/image/document/02253b2ca76d14b1fe7b07eaf8386290.png)

> **说明：**
>
> 如果不确定您的上报域名是什么的话，可以在浏览器控制台输入 `location.host` 查看。对于非 web 应用，默认填了 `*` 表示不需要校验。

用户在 RUM 上创建应用后，会得到一个长度为18位的字符串，这个字符串为上报 ID，new Aegis 的时候传入的 ID 就是这个上报 ID。如果这个 ID 不正确，也会报403。

**Aegis 初始化**

```bash
new Aegis({id: 'pGUVFTCZyewhxxxxxx'})
```

> **说明：**
>
> 如果应用刚创建，RUM 数据同步需要一定的时间，大概在1-2min。

### 日志里面的“图片加载失败”、“JS 加载失败”、“CSS 加载失败” 的问题如何查？

1. 自行访问一下这个资源看是否有异常情况。

2. 若访问正常，但是日志里面还是有比较多的异常情况。

3. 再查看一下这些异常是否有聚集的情况，例如区域聚集，运营商聚集等。

4. 若没有发现有聚集的情况，那大概率是因为用户的网络问题导致的资源加载异常，可以尝试应用中接入 PWA 或者离线包来减少这类情况。本质上，前端没有办法完全避免这种情况。

### 应用接入 SDK 后，为什么会有一个 `aegis.qq.com/speed/webvitals` 的接口在页面刷新的时候 cancel ？

![](https://qcloudimg.tencent-cloud.cn/image/document/6faa905dc7e472048711abbcced8d8ab.png)

webvitals 中 CLS 的值必须是页面可见性改变的时候才计算的，用户刷新页面的时候，如果选中了 Preserve log，就会有一条请求处理发送中，但恰好被页面刷新给 cancel 掉，就出现这种情况。对用户和数据没有影响，可以忽略。

### 有不少错误日志是 “Script error. @ (:0:0) 没啥信息” 这种是第三方 JS 异常吗？可以通过配置过滤掉吗？

Script error. 也被称为跨域错误，当网站请求并且执行一个非本域名下的脚本的时候，如果跨域脚本发生错误，就有可能抛出这个错误。由于应用中，我们的脚本都是放在 CDN 上的，因此这种错误最为常见。

其实这并不是一个 JavaScript Bug。但出于安全考虑，浏览器会刻意隐藏其他域的 JS 文件抛出的具体错误信息，这样做可以有效避免敏感信息无意中被不受控制的第三方脚本捕获。因此浏览器只允许同域下的脚本捕获具体错误信息，而其他脚本只知道发生了一个错误，但无法获知错误的具体内容。更多信息，请参见 [Webkit 源码](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ScriptExecutionContext.cpp)。

![](https://qcloudimg.tencent-cloud.cn/image/document/41892437a0b80429660e0e084a6247c7.png)

**具体解决方式：**

#### 解决办法1：CORS

步骤1：资源添加 crossorigin 属性。

【js】

```bash
<script src="http://another-domain.com/app.js" crossorigin="anonymous"></script>

```

步骤2：CDN 添加 cors 响应头，这个基本是 cdn 默认的，所以实际上我们并不需要做什么。

```bash
Access-Control-Allow-Origin: *
```

#### 解决办法2：try catch

window.onerror 中只能捕获 `Script error.`，但是 try catch 中却能打印详细的错误栈。

```HTML
<!doctype html>
<html>
<body>
    <script src="http://another-domain.com/app.js"></script>
    <script>
        window.onerror = function (message, url, line, column, error) {
            console.log(message, url, line, column, error);
        }
        try {
            foo(); // 调用app.js中定义的foo方法
        } catch (e) {
            console.log(e);
            throw e; // 主动抛出的错误捕获后不是 Script error
        }
    </script>
</body>
</html>
```

如果不想解决，只想直接屏蔽，可以参见下一个问题，不上报特殊日志。

### 对于一些特殊的日志，不想上报到 RUM，可以怎处理？

SDK 提供一个 hook 来帮助用户在日志上报前对日志进行屏蔽和修改，可以使用 beforeRequest，返回 false 就可以不上报该条日志，返回修改过后的 data 就可以实现对上报数据的修改。

**beforeRequest**

【JS】

```bash
new Aegis({
  id: 'pGUVFTCZyewhxxxxxx',
  beforeRequest(data) {
    // 入参data的数据结构：{logs: {…}, logType: "log"}
    if (data.logType === 'log' && data.logs.msg.indexOf('otheve.beacon.qq.com') > -1) {
      // 拦截：日志类型为 log，且内容包含 otheve.beacon.qq.com 的请求
      return false;
    }
    // 入参data数据结构：{logs: {}, logType: "speed"}
    if (data.logType === 'speed' && data.logs.url.indexOf('otheve.beacon.qq.com') > -1) {
      // 拦截：日志类型为 speed，并且接口 url 包含 otheve.beacon.qq.com 的请求
      return false;
    }
    if (data.logType === 'performance') {
      // 修改：将性能数据的首屏渲染时间改为2s
      data.logs.firstScreenTiming = 2000;
    }
    return data;
  }
})

```

### SDK 如何获取网络类型？为什么我的网络类型不正确？

若 UA 里面有 NetType ，则 UA 是从 NetType 获取的。若没有，您用的是 `navigator.connection.effectiveType || navigator.connection.type`，`effectiveType`，则会根据您的网速推算出的一个类型，并不是实际类型。

### 为什么 SDK 上报的接口请求耗时跟 network 里面的时间不一致？

SDK 通过劫持 fetch 和 xhr 的方式实现对接口的测速，在请求前和请求后分别进行打点测速，因为 JS 计算时间差的逻辑依赖 js 主线程执行，如果 end 时间执行的时候有线程阻塞，会导致实际计算的时长要大于浏览器 network 时长。

### 为什么上报的网络类型跟实际网络类型不符合，例如当前用户使用的是 wifi，上报的却是4G？

我们目前通过 UA 里面的 NetType 和 `navigator.connection.effectiveType` 获取网络类型，前者依赖浏览器注入网络信息到 UA，后者是浏览器提供的 “等效网络类型”，并不代表真实的网络类型。`navigator.connection.effectiveType` 这个 API 目前还存在兼容性问题，IOS 暂不支持，所以会被识别为未知。

### 我开启了 SPA 参数，但是页面之间跳转的时候，为什么没有上报页面性能呢？

SPA 页面之间的跳转，本质上只是一段 JS 代码的执行，首屏探测的是从用户浏览器发起请求到页面可见元素渲染完成的时间，因此没有办法计算首屏。

### 日志里面上报了非常多 AJAX 异常，状态码是0，这个可能是什么原因导致的？

![](https://qcloudimg.tencent-cloud.cn/image/document/befdfabb20b0faee224795899c1b75a0.png)

HTTP 接口的 status 是0，有以下几种可能：超时、abort、cancel、跨域。

开发者本地调试可能没有发现这种错误，但是在用户侧却能经常发生，这个是什么原因呢？因为用户侧可能随时离开页面，或者因为网络问题把某次 HTTP 请求中断了，这种情况就会发生 status 为0的情况。

虽然 status 为0有多种情况，但是我们也可以根据日志里面的信息看出一些端倪。例如：上述截图里面的耗时都非常小，而且发生的用户比较集中，因此可以判断该接口是浏览器插件屏蔽掉了，这种情况常见于一些数据上报的接口。如果接口出现比较随机，耗时也不高，整体量也不算大，这种情况，abort 和 cancel 的概率比较大，经常发生于用户离开页面，刷新页面，接口没有请求完成的情况。如果看到 duration 非常长，那超时的可能性就比较大了，开发者也可以查看自己接口的超时时间来进行对比。至于跨域的情况，可以检查一下后台的业务逻辑是否正常，而 cancel 的情况，多半是前端业务控制的，也可以看下具体的业务逻辑。

#### 开发者本地调试可能没有发现这种错误，但是在用户侧却能经常发生，这个是什么原因呢？

因为用户侧可能随时离开页面，或者因为网络问题把某次 HTTP 请求中断了，这种情况就会发生 status 为0的情况。

虽然 status 为0有多种情况，但我们也可以根据日志里面的信息看出一些问题。例如上述截图里面的耗时都非常小，而且发生的用户比较集中，因此可以判断该接口是浏览器插件屏蔽掉了，这种情况常见于一些数据上报的接口。

如果看到 duration 非常长，那超时的可能性就比较大了，开发者也可以查看自己接口的超时时间来进行对比。至于跨域的情况，可以检查一下后台的业务逻辑是否正常，而 cancel 的情况，多半是前端业务控制的，也可以看下具体的业务逻辑。

#### 我API监控页面看到了非常多接口的 retcode 成功率都是0，或者很低，这个是因为什么？

SDK 通过从用户接口的返回值中的第一层和第二层中获取 [code, ret, retcode, errcode] 这几个参数中的任意一个，作为接口业务的返回码（区别于 HTTP 的状态码），默认这个返回码等于0接口为正常。

业务对于返回码有不同的定义，开发者可以通过 api 参数下的 [retCodeHandler](https://cloud.tencent.com/document/product/1464/58560) 函数对其进行矫正，retCodeHandler 函数返回 isErr 和 code 两个值。isErr 用来计算接口返回值的成功率，code 用来统计接口的返回码占比。当该函数返回 isErr 为 true 的时候，这个接口的信息会同时上报到历史日志里面的“接口返回码异常”，方便开发者定位接口问题。除此之外，还有很多非业务的接口，如一些数据上报，是不满足这些规范的，建议可以通过 [beforeRequest](https://cloud.tencent.com/document/product/1464/58557) 进行修正。

#### 为什么我接入 Aegis 后没有首屏数据？

Aegis sdk 根据 DOM 变化记录首屏，如果您的 sdk 引入较晚，或者初始化较晚，可能会出现无法获取首屏的情况。如果出现这种情况的话，建议可以试着把 sdk 引入和初始化放在更前面，如 head 里，然后再观察一下数据。

#### 为什么有些接口的测速数据没有上报？

有可能是因为初始化 Aegis 的时候这个接口已经发出去了。Aegis web sdk 目前只劫持了 fetch 和 xhr 两种发送请求的方式，如果您的请求是其他的方式，例如 beacon，就无法监控到。Aegis 小程序 sdk 也是通过劫持 wx.request 实现的，如果在引入 Aegis 之前，wx.request 已经被修改了，也可能监控不到，建议尽早引入和初始化 Aegis sdk。

#### 页面首屏和页面完全加载时间有什么关系？

总体来说，页面首屏和页面完全加载时间是正相关的。大多数情况下，用户的首屏时间是小于页面完全加载的。Aegis SDK 根据用户页面 DOM 变化计算首屏时间，如果用户页面完全加载后，还继续发生 DOM 变化，就有可能发生首屏时间晚于页面完全加载的情况。在服务端直出场景，瀑布图会出现首屏时间大于 DOM 解析的情况，这是由于移动端设备兼容性问题，有些设备无法获取到 DNS 查询、TCP 连接、SSL 建连时间，这三个指标汇总后的平均值偏小，导致除了首屏时间外的其他指标都往左偏移。

#### 我想要全量上报所有接口的信息需要怎么办？

```js
new Aegis({
  id: '',
  api: {
    reportRequest: true, // 接口全量上报，info 对全部用户生效
    apiDetail: true, // 上报接口的同时，也会上报接口请求参数和返回值
  },
})
```

#### 对于 SSR 页面，接入 aegis sdk 需要注意哪些问题？

接直出的页面需要注意两件事情:

1. aegis-web-sdk 只能运行在浏览器环境，所以记得在服务端不要执行初始化操作。

2. SSR 页面初始化完成比较早，所以如果把 aegis-sdk 初始化放在比较靠后的地方（body 里面或者最后）可能会导致 sdk 无法获取到页面首屏的情况。建议 SSR 页面使用 script 标签引入 aegis sdk，并且放在 head 中初始化，解决上述两个问题。

#### 我的接口名称是写在接口的参数里面的，如何进行上报？

aegis sdk 上报数据的时候，默认只上报了接口的 url，没有上报参数，对于这种情况，我们提供 reportApiSpeed.urlHandler 钩子函数对上报内容进行修正，用户可以根据 urlHandler 参数里面的内容进行优化。

例如：腾讯云控制台上的接口，名称统一都是 `console.cloud.tencent.com/cgi/capi`，接口真实名称通过参数里面的 cmd 确定，这样的情况，优化方式如下：

```javascript
new Aegis({
  id: '',
  reportAssetSpeed: true, // 静态资源测速
  reportApiSpeed: {
    urlHandler(url) {
      if (url.indexOf('/cgi/capi') > -1) {
        const urls = url.split(/[=|&|?]/)
        if (urls.length > 6) {
          url = `${urls[0]}/${urls[6]}/${urls[2]}`
        }
      }
      return url
    },
  },
})
```

# 使用相关问题.md

### 接入前端性能监控，小程序接入，正式环境需要将上报域名添加到安全域名中。安全域名要怎么添加？

Aegis SDK 使用 `https://aegis.qq.com` 进行数据上报，如果不希望使用 qq 域名，您也可以修改为 `https://rumt-zh.com`。您可登录 [微信公众平台](https://mp.weixin.qq.com/) > **开发管理** > **服务器域名**，完成配置。

![](https://qcloudimg.tencent-cloud.cn/image/document/19416e656935db2e2b12d5a16f4f4db7.png)

### 初始化 SDK 的时候传入的 UIN 是什么？

User Identification Number 用户唯一标识，简称 UIN，是 Aegis SDK 提供给业务侧填写的用户唯一标识，RUM 不进行校验 UIN 是否是一个真实标识，只把它作为查询日志的索引。开发中可以把业务提供的用户 ID 写入，也可以写入 open-id、uuid 等信息，只需方便您查询即可。

### 自定义测速耗时为什么仅支持0 - 60000之间的数据？

自定义测速的逻辑是用户上报任意数据，我们对用户数据进行求均值和中位数，并把它们作为展示的数据。由于无法判断服务端的脏数据，若产生少量脏数据，将会对用户实际数据产生非常大的影响。因此我们目前在服务端对用户数据进行了限制，目前只支持0 - 60000内的数据。

### RUM 根据哪个字段来计算 UV？

Aegis SDK 为每个用户独立生成一个 aid 作为用户（设备）的唯一标识，存储在浏览器的 localStorage，用于计算 UV。aid 不受登录状态影响，只有用户清理浏览器缓存 aid 才会更新。

### RUM 为什么不根据用户 UIN 来计算 UV？

如果当前用户没有登录，则没有 UIN 值，并且 UIN 值由开发者设置，可靠性比较低，也无法将用户登录前后的状态统一。

### 日志类型里面的接口请求日志是什么？

有两种情况用户会把接口请求信息发送服务端：

- 白名单用户将接口请求日志发送上来。

- 对于一般用户，如果发生 js 错误，我们会同步把错误发生之前的一些接口信息也发上来，用于帮助用户查找分析问题。

  接口请求日志是用户接口的请求和返回内容。一般只有白名单用户才会上报接口请求日志，或者如果开发者在 sdk 里面开启全量接口上报，也会上报接口请求日志。

### 首屏时间（FirstScreenTiming）是怎么计算的？

监听页面打开3s内的首屏 DOM 变化，并认为 DOM 变化数量最多的那一刻为首屏框架渲染完成时间（SDK 初始化后 setTimeout 3s收集首屏元素，由于 JS 是在单线程环境下执行，收集时间点可能大于3s）。

### 性能里面的 DOM 解析（DOM parse）时间是如何计算的？

PerformanceTiming 接口中的 domInteractive 到 domLoading 所消耗的时间。

### RUM 采集数据时用的时间是客户侧（如浏览器）还是服务侧？中间的延迟大概会有多久？

RUM 采集数据时用的服务侧的时间，时间显示会比实际上报延迟1s - 2s，日志搜索可能有1分钟 - 2分钟延迟。

### 接入**前端性能监控后，没有数据是怎么回事？**

**可以从以下几个方向查找问题：**

- 查看上报接口（rumt-zh.com 或者 aegis.qq.com）是否正常，正常返回200和204，如果有一些接口返回403可以看 [技术排查相关问题](https://cloud.tencent.com/document/product/248/87249)。

- 看日志查询里面页面访问和历史是否有数据，如果没有数据，有可能是上报延迟导致（1分钟 - 2分钟）。

- 数据总览里面的数据是每整数小时计算一次，如果没有数据可以看下是否上个小时没有页面访问，或者新接入还没开始计算。

- 如果是页面性能没有数据，或者缺少数据，可以看下 network 中上报接口 performance 中 firstScreenTiming 的值，如果这个值为0或者大于15s，就会导致页面性能缺少数据。解决办法：把 SDK 初始化尽可能放在代码最前面，可以考虑用 CDN 并且在 head 中初始化代码，尤其对于一些 SSR 的页面，因为页面首屏时间较小，初始化 SDK 过晚会导致无法采集到页面首屏信息。

  > **注意：**
  >
  > 目前只有 web 和小程序支持首屏算法。

### 接入前端性能监控后，如何查看当前项目上报量？

业务使用 RUM，可以在 [前端性能监控 > 应用管理](https://console.cloud.tencent.com/monitor/rum/manage) 的**业务系统**或者**应用设置**页面查看上报量。

- 业务系统页面

  ![](https://qcloudimg.tencent-cloud.cn/image/document/6295a225ba3baf5c5c0e438a0dbf9670.png)

- 应用设置页面

  ![](https://qcloudimg.tencent-cloud.cn/image/document/937b047b277d5fdea8a0df04430201ff.png)

### 接入前端性能监控后，日志中的“图片加载失败”、“JS 加载失败”、“CSS 加载失败” 问题如何处理？

首先自己访问一下这个资源是否存在异常情况。如果访问正常，但是日志里面还是有比较多的异常情况，再查看一下这些异常是否有聚集的情况，例如区域聚集、运营商聚集等。如果没有发现有聚集的情况，可能是因为用户的网络问题导致资源加载异常，可以尝试项目中接入 PWA 或者离线包来减少这类情况。本质上，前端没有办法完全避免这种情况。

### 为什么接入 Aegis 后没有首屏数据？为什么上报接口中首屏数据 firstScreenTiming 为0？为什么页面性能数据那么少？为什么首屏数据那么大？

Aegis sdk 根据 DOM 变化记录首屏，如果 SDK 引入较晚，或者初始化较晚，可能会出现无法获取首屏的情况。当出现这种情况时，建议可以试着把 SDK 引入和初始化放在更前面，例如 head 里，然后再观察一下数据。

尤其针对服务端直出的项目（SSR），页面加载完成即首屏完成，如果 Aegis sdk 初始化较晚，就会上报一个首屏时间 **firstScreenTiming** 为0的数据，该数据不是有效数据，因此不参与计算，导致样本量减少，而少数有值的数据上报，综合计算又导致整体首屏值计算偏高。

![](https://qcloudimg.tencent-cloud.cn/image/document/cdeb845f9ba209e506b1186e0af6ca3d.png)

除此之外，少数非常大的首屏值（异常用户）也会影响平均值，用户可以看下中位数的值是否正常。

### 为什么页面上报了很多重复数据，例如页面切换时重复上报多个 pv?

可能是重复初始化了多个 Aegis 的实例，建议检查业务逻辑。

### 对于 SSR 页面，接入 Aegis SDK 需要注意哪些问题？

1. aegis-web-sdk 只能运行在浏览器环境，所以记得在服务端不要执行初始化操作。

2. SSR 页面初始化完成较早，所以如果把 aegis-sdk 初始化放在比较靠后的地方（body 里面或者最后）可能会导致 SDK 无法获取到页面首屏的情况。建议 SSR 页面使用 script 标签引入 Aegis SDK，并且放在 head 中初始化，解决上述两个问题。

### 日志搜索为什么没办法搜模糊匹配？

例如页面地址为 `https://test.abcdefg.qq.com/`，希望通过 `from:test.*.com` 对这个页面进行搜索，结果发现没办法搜到数据。

建议用户修改搜索关键词，使用多个关键词进行搜索，例如 from: "test" AND from “[腾讯网](https://www.qq.com/)”

### 为什么接口错误率上报失败率接近100%，但实际接口返回正确？

正常情况下，是由于业务或者第三方框架手动调用 xhr.abort() 导致的。此时 aegis 会获取到 xhr.readyState=0，并且 xhr.status=0，此时会认为接口请求失败。需要重点排查下业务或者第三方框架（特别是 angular），重点搜索下 abort。

### 前端监控里面统计到的接口耗时（静态资源耗时）跟后端统计的相差很远，可能是什么原因导致的？

1. 用户网络问题，请求没有发生到后端，耗时比较久后失败了。

2. 用户请求发出了，但是中间网络层耗时比较久，后端处理很快，但是过了很久才返回给用户。

3. 用户看的是平均值，可能由于某个或者某几个用户出现比较高的异常值导致整体值偏低，用户可以看下中位数是否依然异常。

4. 用户请求接口(静态资源)受多方面因素影响：网络、地域、设备都会对最终值产生影响。

5. cdn 没有预热，dns 第一次解析耗时比较久等原因都会导致前后端统计不一致。

6. 前端性能监控只是把这个耗时记录下来，并不对这个耗时负责。

### 前端监控统计到 cdn 资源失败，但是实际自己访问没有出现问题，可能是什么原因导致的？

首先看下对应 cdn 的成功率是多少，如果这个 cdn 大概率都是成功的，可能是因为前端访问这个资源时超时、abort 等因素导致的，一般情况可以忽略。

如果 cdn 整体成功率不高，可能就是 cdn 确实有问题了，您可以从以下几个方面去查：

- 本地访问这个 cdn 是否有问题，如果有问题，找具体人排查。

- 看下区域分布是否有问题，可以看前端监控的数据，也可以在 [腾讯云诊断服务平台](https://cloud.tencent.com/document/product// https://huatuo.qq.com/) 查看资源。

- 同样可以看下运营商分布，也可能出现局部运营商把 cdn 封禁的情况。

### 为什么不能看某个具体用户的性能数据，例如接口耗时、静态资源耗时、首屏耗时等数据的原始数据？

对于性能类的数据，我们只保留了计算后的数据，例如平均值、错误率、中位数、90分位数等，所以无法根据用户信息进行查找。如果用户对此有诉求，可以用以下几个方式进行查询：

1. 开启全量接口耗时上报，具体参考 [api.reportRequest](https://cloud.tencent.com/document/product/248/87249#.E6.88.91.E6.83.B3.E8.A6.81.E5.85.A8.E9.87.8F.E4.B8.8A.E6.8A.A5.E6.89.80.E6.9C.89.E6.8E.A5.E5.8F.A3.E7.9A.84.E4.BF.A1.E6.81.AF.E9.9C.80.E8.A6.81.E6.80.8E.E4.B9.88.E5.8A.9E.EF.BC.9F)。

2. 如果业务数据量比较少，可以把用户信息写到 ext 中，然后通过 ext 进行查询。

3. 可以在 beforeRequest 中把性能数据，例如接口耗时、静态资源耗时等信息通过 aegis.infoAll 上报到历史日志中，然后去历史日志中进行查询。

### 在日志里面的 js 错误日志里面看到一些莫名其妙的错误，代码里面找不到相关的问题，可能是哪些原因导致的？

有些用户在历史日志中，发现了一些奇怪的报错，本地不会复现，并且搜源码也没搜到相关的问题。这种情况大概率由于用户侧执行的代码跟开发者执行的代码不一致导致的。

![](https://qcloudimg.tencent-cloud.cn/image/document/97e852ad94bc516f2b7018c8c7126b33.png)

可以从两个方面排查这类问题。首先，如果报错的用户比较集中（可以根据 aid、IP 等信息来看），可能是由于用户浏览器插件导致的。如果用户有某些聚类特征，例如主要集中在某个地区、某个运营商等，也有可能是 cdn 劫持导致的。

- 如果是 cdn 劫持，开发者可以通过使用 sri 等方案来解决。

- 如果是浏览器插件导致的，其实对整个业务没什么影响，可忽略。如果不希望出现在报错信息中，也可以通过 beforeRequest 钩子函数进行屏蔽，具体参考 [处理方法](https://cloud.tencent.com/document/product/248/87249#.E5.AF.B9.E4.BA.8E.E4.B8.80.E4.BA.9B.E7.89.B9.E6.AE.8A.E7.9A.84.E6.97.A5.E5.BF.97.EF.BC.8C.E4.B8.8D.E6.83.B3.E4.B8.8A.E6.8A.A5.E5.88.B0-rum.EF.BC.8C.E5.8F.AF.E4.BB.A5.E6.80.8E.E5.A4.84.E7.90.86.EF.BC.9F)。

- 如果用户页面运行在某些终端中，或者小程序中，也有可能终端或者小程序注入代码导致 js 报错，如常见的“ReferenceError: Can't find variable: WeixinJSBridge”

### 开启了 SPA 参数，但是页面之间跳转的时候，为什么没有上报页面性能呢？

SPA 页面之间的跳转，本质上只是一段 js 代码的执行，首屏探测的是从用户浏览器发起请求到页面可见元素渲染完成的时间，因此，没有办法计算首屏。

### 抽样是如何抽的？

目前抽样分为服务端抽样和客户端抽样，客户端抽样通过参数 random 来控制。

```plaintext
new Aegis({
   id: 'pGaaFTC******VTKBe',
   random: 0.5 // random 0~1
});
```

无论服务端抽样还是客户端抽样，都是基于用户级别的抽样（即如果一个用户命中黑名单，所有 aegis 上报接口都不会上报）。

> **注意：**
>
> - 如果同时设置服务端抽样和用户抽样，则实际抽样率为：客户端抽样率 * 服务端抽样率。
> - 白名单用户不受抽样率影响。
> - 服务端抽样通过 whitelist 接口下发抽样率控制，实际上报量会比设置的抽样率高，因为有些接口在 whitelist 接口返回之前就上报了。
> - RUM 中可以设置精准的服务端采样。

### 为什么使用 aegis-first-screen-timing 标记后的元素不是最终 aegis.firstScreenInfo 里面的元素？

aegis.firstScreenInfo 默认为关闭状态，如果需要该值，需要主动开启。

```plaintext
new Aegis({
  id: '',
  pagePerformance: {
    firstScreenInfo: true,
  }
})
```

因为标记的元素有可能是跟其父元素同时被 MutationObserver 收集进来的，此时 aegis.firstScreenInfo 里面的 element 和 markDoms 对应的是标记元素的父元素。如果 aegis.firstScreenInfo 为 undefined，请注意设置 aegis-first-screen-timing 的元素必须得有宽高，同时 window.innerWidth、window.innerHeight 也需有值。

1. 可以尝试把 aegis 使用 cdn 的方式引入，并且在 head 中进行初始化，看下是否初始化太晚导致的。

2. 在渲染后的 html 中看下 dom 中标记的元素是否存在，标记的自定义属性是否存在，有些构建工具会自动删除这类自定义属性。

### 第三方 SDK、插件、组件内部可以使用 Aegis SDK 吗？

不建议这样使用，因为我们的 SDK 是由 for 页面设计，默认采集页面的 pv、错误、全局的接口信息等，如果您在自己的 SDK 内部使用了 Aegis SDK，会导致页面数据重复采集、xhr 重复劫持等问题。而且 Aegis SDK 默认采集数据上报，用户页面并没有授权第三方的 SDK 采集其他页面的数据，因此可能还存在合规的问题。

### 上报数据中的 eval 为什么会变成 evaI？

js 里面 eval 是一个敏感操作，之前会被腾讯的网关屏蔽报错，所以被改成了 evaI。

![](https://qcloudimg.tencent-cloud.cn/image/document/b2fa64c7d1012baefe00a8dbb58decfe.png)

### 小程序上报的 referer 的值如何理解？

小程序的 referer 指的是小程序的场景值，具体值可以参考 [小程序文档 ](https://developers.weixin.qq.com/miniprogram/dev/reference/scene-list.html)。

### 小程序 SDK 初始化之后报错 “unexpected loadSdkSubPackage”。

可点击 [此处](https://developers.weixin.qq.com/community/develop/doc/00064ae612c4d0bbd63f8add256800) 参考解决。可以更新微信开发工具，或者在微信开发者工具的**详情**页面，在**本地设置**中勾选**启用独立域进行调试**。

### 上报统计的接口耗时跟浏览器中 network 中接口耗时不一致可能是什么原因导致的？

Aegis SDK 中默认采用劫持 xhr 和 fetch 请求的方式统计接口耗时，即在接口请求之前打一个点，接口请求之后打一个点，然后计算这两个点之间的时间差值，为接口耗时。这样统计接口耗时可能跟 network 中接口真实耗时有所不同，可能看起来明显大于真实接口耗时。主要有以下几个原因导致：

- 浏览器有请求并发限制，js 代码把请求事件发送给浏览器之后，浏览器并不是立即执行的，而且把所有接口排队然后执行，如果接口使用 http/1.x 协议并且进入到浏览器并发限制，就会导致这个问题。因为我们统计的是 js 的耗时，浏览器阻塞时间会默认加上，导致统计时间大于真实接口耗时。

- js 打点的方式也会遇到单线程阻塞的问题，两次计时的代码并非真实时间，而且两次时间循环的时间，就像遇到的 setTimeout 和 setInterval 的问题一样。

  **解决方案：**

  可以开启 api.usePerformanceTiming 参数。开启后，Aegis SDK 会从 performance 中重新获取接口耗时，让接口耗时统计更为准确。需要注意的是，开启该参数的前提是用户业务接口请求 url 是独立且唯一的，用户可以在接口请求 url 中添加时间戳等方式来保证 url 唯一性。如果 url 不唯一，可能导致同 url 接口耗时获取错误，业务本身无重复 url 的情况则可以直接开启。

### 数据总览里面的首屏耗时或者请求耗时为什么与详情页面里面查到的数据不一致？

数据总览里面的值，是通过定时任务计算出来的，每个小时计算一次，如果选了多个小时，相当于多个小时的计算平均值的平均值，而数据详情里面的值，是真实的平均值，所以这两个略有区别。

- [数据总览](https://console.cloud.tencent.com/monitor/rum) 的值。

  ![](https://qcloudimg.tencent-cloud.cn/image/document/dcb6f4c6425d8266c9b9627399c3fdd2.png)

- 数据详情的值，在 [页面性能](https://console.cloud.tencent.com/monitor/rum/access) 中查看。

  ![](https://qcloudimg.tencent-cloud.cn/image/document/715e5c3b3df824a495c976a8ec3d058b.png)

### Aegis SDK 中是否有限制日志长度？

Aegis SDK 中有限制每条日志的 msg 字段最大长度为10k，超过时日志的 msg 字段会被截断，然后再进行发送。同时，限制了预定义的扩展字段（ext1、ext2、ext3）最大长度为1024。建议在上报日志前检查 msg 长度，对超过10k 的日志预先进行处理。

### 首屏数据能把 url 后面的 query 参数带上吗？

![](https://qcloudimg.tencent-cloud.cn/image/document/104b2f723b4c292954db32c9aa3472d8.png)

RUM 对于性能数据的页面地址，只取了 path，不取 query ，核心是为了降低 query 对数据聚合的影响。但是有些用户的页面核心信息是写在 query 里面的，导致无法区分不同页面的性能。对此，我们提供一个 [钩子函数](<https://cloud.tencent.com/document/product/248/87197#pageperformance.urlhandler.5B.5D(id.3Aexp3)>)。用于修改上报性能数据的地址。

![](https://qcloudimg.tencent-cloud.cn/image/document/7bbde6c74da24263c8fd255a847b704f.png)

只需要在 urlHandler 中修改返回值就行，该返回值就是上报页面性能数据中页面地址的值。

> **注意：**
>
> 在修改时，可以把需要的 query 关键词放在 path 里面，例如原 url 是 `https://a.qq.com/?name=tick`，可以修改为 `a.qq.com_tick`。

### webvitals 里面统计的 FCP 和 LCP 是否包含了浏览器滚动条滚动后页面的渲染？如果用户有操作，例如 spa 页面跳转、页面重新渲染，时间是否有影响？

webvitals 中的数据是从浏览器 API 中获取的，所以这部分实现对于我们来说是黑盒的，但是我们也可以根据官方给出的描述和自己实验给出结论。

首先拿 LCP 来说，看官方的定义：

**Largest Contentful Paint is the metric that measures the time a website takes to show the user the largest content on the screen, complete and ready for interaction. Google defines that this metric considers only the content above the page's fold, meaning everything that appears without scrolling.**

由此可见，页面滚动后的内容渲染不在 LCP 的计算范围内，对于“页面渲染时触发浏览器操作是否有影响”这个点，我们可使用 Chrome 浏览器放慢网速，模拟相关操作，发现也是没有计算在内。再重新理解这个定义，可以看到 “complete and ready for interaction” 表示的是在浏览器可交互之前，且浏览器未发生滚动的时候，页面最大元素渲染完成时间。

### Aegis SDK 采集到错误 Failed to execute 'trAansaction' on 'IDBDatabase' 如何解决？

Aegis SDK 中，如果开启了离线日志，会将用户日志写到 indexedDB 中，如果浏览器 indexedDB 满容或者支持性有问题，就会报这个错误，目前对用户侧无影响。由于离线日志已经下线，建议用户升级 SDK，或者关闭离线日志（删除初始化中 offlineLog: true 这行代码）。

### Aegis SDK 可以自动捕获 console.error 的错误吗？

不能，因为可能导致重复重写的问题，例如用户自己已经重写过 console.error 了，捕获后进行上报；如果用户对这个逻辑不了解，可能会导致一些敏感数据上报，因此 Aegis SDK 默认没有捕获 console.error 中抛出的日志。用户有需求的话可以自行重写，并且使用 aegis.report 或者 aegis.error 进行上报。

### JS 错误率的分母是怎么来的？

分母数据来源于 PV 总条数。

![](https://qcloudimg.tencent-cloud.cn/image/document/59e97f4ea40d1508a59cabbd84002ad7.png)

### 在使用前端性能监控的 aegis-web-sdk 时，由于 sdk 自带 flog: "https://cdn.go.cn/vasdev/web webpersistance y2/v1.8.2/flog.core.min.js"这一段远程代码，导致这的插件无法通过审核，怎么解决？

升级最新的 SDK 即可，目前最新版本为1.39.1。

### 上传一种 URL，却出现两种 URL 格式？

![](https://qcloudimg.tencent-cloud.cn/image/document/5207b98561de2ffa2983bff45a57ce01.png)

目前后台为两部分：node 和 go。node 里面上报指标用的是纯文本协议，不能有特殊字符，因此我们就在 node 代码里面将 ：替换成 _ 。后期会将全部流量都迁移至 go，此问题会被解决。

### RUM 告警不支持蓝鲸？

只有上报域名 `aegis.qq.com` 才支持蓝鲸。

### performance 页面测速接口上报两次？

客户自己设置某个元素为首屏元素 AEGIS-FIRST-SCREEN-TIMING，当 aegis 识别到该元素后认为首屏已经完成，会立马上报。第二次上报为正常上报。

### RUM 报表的每日邮件推送未收到？

检查 [通知模板](https://console.cloud.tencent.com/cam/groups) 的账户邮箱是否已经验证。

### RUM 上报接口报错400？

本地检查上报参数，一般400参数是上报参数异常。

### 每条上报日志长度大小为多少？

每条日志的字符最多只能有200 * 1024个。

### RUM 会上报过滤敏感词日志吗？可以修改过滤配置吗？

会的，一般涉及公司内部的敏感词汇日志会被过滤。例如 facebook、baidu、zhiyan 等；不能修改过滤配置，涉及安全风险。

### RUM 支持 traceId 查询全链路信息吗？如何使用？

支持。具体参考腾讯云可观测平台 [OpenTelemetry 前后链路打通](https://cloud.tencent.com/document/product/248/87108)。

### DAU、WAU、MAU 分别表示日，周，月的什么指标？

数据根据 aid 进行计算，aid 是 sdk 为用户独立生成的唯一标识。

- DAU：日活跃用户数

- WAU：周活跃用户数

- MAU：月活跃用户数

  ![](https://qcloudimg.tencent-cloud.cn/image/document/9053a437d6561446d653f631f4d54975.png)

### 首屏耗时的定义

首屏耗时表示监听页面打开3s内的首屏 DOM 变化，并认为 DOM 变化数量最多的那一刻为首屏框架渲染完成时间（SDK 初始化后 setTimeout 3s收集首屏元素，由于 JS 是在单线程环境下执行，收集时间点可能大于3s）。

### 没找到 lcp\fcp 指标的上报？上报时机是怎样的？

部分指标依赖页面隐藏，时机是在切换页面上报，本地可以切换 tab 看看。

### flv 数据格式导致请求不会断开

升级最新版 sdk 即可，已经兼容 flv。

### 不引入 aegis-sdk，直接使用接口上报日志可以吗？

可以支持，但不建议。

### 直接使用接口上报日志，有上报量，但没有详细日志？

请求中要携带 logBody 参数，未携带 logBody 则只会统计上报量，没有日志。着重注意 content-type 的内容是 json 还是 urlParams 格式。

# aegis-web-sdk

Aegis 是腾讯云监控团队提供的前端监控 SDK，涵盖了错误监控，资源测速（img, script, css），接口测速，页面性能（首屏时间）。无需侵入代码，只需引入 SDK 即可自动完成所有监控上报。

在使用 aegis 时无需在业务代码中打点或者做任何其他操作，可以做到与业务代码充分解耦。aegis 将会自动监控前端错误，在错误发生时上报错误的具体情况，帮助您快速定位问题。当您开启资源测速时，aegis 将会自动监听页面资源加载情况（耗费时长、成功率等），并在不影响前端性能的前提下收集前端的性能数据，帮助您快速定位性能短板，提升用户体验。

使用本 SDK 需要配合使用腾讯云前端性能监控 [RUM 平台](https://console.cloud.tencent.com/rum)。

## Usage

1. 前往腾讯云前端性能监控 [RUM 平台](https://console.cloud.tencent.com/rum)

2. 申请项目，申请完成后得到`上报 id`，id 在 sdk 初始化的时候会使用。

Aegis SDK 在上报所有数据时都会带上`上报 id`，后端服务将根据`上报 id`辨别数据来自哪一个项目，因此，Aegis 建议为每一个项目都单独申请一个 id，如果一个项目下有多个页面，还可以为每一个页面都申请一个项目 id，方便单独查看每一个页面的 PV、错误率、请求错误率等数据。

aegis-sdk 默认使用 `https://rumt-zh.com` 作为上报域名，您也可以选择修改 hostUrl 参数使用 `https://rumt-zh.com` 作为上报域名。如果是腾讯内网用户，有特殊需求也可以使用 `https://aegis-report.woa.com` 作为上报域名。

## 使用SDK

### 安装 SDK

针对各种情况， SDK 提供了三种引入方式，选择适合业务中的一种即可。无论哪种使用方法，请务必保证 sdk 在 `<head></head>` 内，最先声明。这样能保证拿到各类数据监控。

1. cdn 引入

资源地址如下：

最新版本：https://tam.cdn-go.cn/aegis-sdk/latest/aegis.min.js

特定版本(注意链接中的版本号)：https://tam.cdn-go.cn/aegis-sdk/{version}/aegis.min.js

> 版本说明：为了保证CDN的稳定性，“latest” 版本将会比“npm”版本稍滞后一些；

安全身份识别版本：https://tam.cdn-go.cn/aegis-sdk/latest/aegis.f.min.js

> 功能说明：引入浏览器指纹算法，提升uv准确率；增强安全审计功能。

将会在 window 上挂载 `Aegis` 构造函数。

该 cdn 使用 “h3-Q050” 协议，默认 cache-control 为 max-age=666，如果需要修改 cache-control，可以添加参数 max_age，如

```html
<script src="https://tam.cdn-go.cn/aegis-sdk/latest/aegis.min.js?max_age=3600"></script>
```

2. npm 引入

```sh
$ npm install aegis-web-sdk
```

2. 内联引入

如果想要把 SDK 代码直接内联到 html 中的话，可以选择直接 copy 代码的方式，或者使用您熟悉打包工具的内联代码的工具

**推荐使用 CDN 的方式使用 aegis，可以享用更新更全的功能，更及时修复 bug，并且体验无感升级的快感。**
我们也会尽全力保证 CDN 版本的稳定，请您方便使用。

### SDK 实例化

引入 SDK 后，需实例化:

```javascript
// 如果使用 npm 可以直接 import
import Aegis from 'aegis-web-sdk'

// 如果使用 cdn 的话，Aegis 会自动绑定在 window 对象上
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx', // 项目上报id
  uin: 'xxx', // 用户唯一标识（可选）
  reportApiSpeed: true, // 接口测速
  reportAssetSpeed: true, // 静态资源测速
  hostUrl: 'https://rumt-zh.com', // 上报域名，中国大陆 rumt-zh.com
  spa: true, // spa 页面需要开启，页面切换的时候上报pv
})
```

::: warning 注意 ⚠️
为了不遗漏数据，须尽早进行初始化；
初始化之后，可以打开控制台查看上报接口是否正常，network 中搜索上报域名（默认 rumt-zh.com）查看上报数据情况。
如果上报接口返回 403 可以查看 [技术排查相关问题](https://cloud.tencent.com/document/product/1464/58608)。
:::

::: tip 当您做了以上接入工作之后，您已经开始享受 Aegis 提供的以下功能：
1、错误监控：JS执行错误、Promise错误、Ajax请求异常、资源加载失败、返回码异常、pv上报、白名单检测等；  
2、测速：页面性能测速、接口测速、静态资源测速；  
3、数据统计和分析：可在 [RUM 平台](https://console.cloud.tencent.com/rum) 上查看各个维度的数据分析；  
:::

## 日志

Aegis SDK 会主动收集用户的一些性能和错误日志，开发者可以根据不同的参数来配置哪些日志需要上报，以及上报的日志具体信息。

### 日志类型

全部日志类型如下：

```javascript
{ logType: 'custom', name: '自定义测速' }
{ logType: 'event', name: '自定义事件' }
{ logType: 'log', name: '日志' }
{ logType: 'performance', name: '页面测速' }
{ logType: 'pv', name: '页面PV' }
{ logType: 'speed', name: '接口和静态资源测速' }
{ logType: 'vitals', name: 'web vitals' }
```

### 日志等级

全部日志等级如下：

```javascript
  { level: 1, name: '白名单日志' },
  { level: 2, name: '一般日志' },
  { level: 4, name: '错误日志' },
  { level: 8, name: 'Promise 错误' },
  { level: 16, name: 'Ajax 请求异常' },
  { level: 32, name: 'JS 加载异常' },
  { level: 64, name: '图片加载异常' },
  { level: 128, name: 'css 加载异常' },
  { level: 256, name: 'console.error' },
  { level: 512, name: '音视频资源异常' }
  { level: 1024, name: 'retcode 异常' }
  { level: 2048, name: 'aegis report' }
  { level: 4096, name: 'PV' }
  { level: 8192, name: '自定义事件' }
  { level: 16384, name: '小程序 页面不存在' }
  { level: 32768, name: 'websocket错误' }
  { level: 65536, name: 'js bridge错误' }
```

## aid

Aegis SDK 为每个用户设备分配的唯一标识，会存储在浏览器的 localStorage 里面，用来区分用户，计算 uv 等。aid 只有用户清理浏览器缓存才会更新。

对于一些项目，使用自己构造的 aid 作为上报规则，后端对 aid 的校验规则如下：`/^[@=.0-9a-zA-Z_-]{4,36}$/`

## 实例方法

Aegis 实例暴露接口简单实用，目前 Aegis 实例有以下方法供您使用：  
`setConfig` 、 `info` 、 `infoAll` 、 `report` 、 `error` 、 `reportEvent` 、 `reportTime` 、 `time` 、 `timeEnd`、 `destroy`

### setConfig

该方法用来修改实例配置，比如下面场景：  
在实例化 Aegis 时需要传入配置对象

```javascript
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  uin: '777',
  //...其他配置
})
```

很多情况下，并不能一开始就获取到用户的 `uin`，而等获取到用户的 `uin` 才开始实例化 Aegis 就晚了，这期间发生的错误 Aegis 将监听不到。`uin` 的设置可以在获取到用户的时候：

```javascript
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  //...
  //...其他配置
})

// 拿到uin之后...
aegis.setConfig({
  uin: '6666',
})
```

### info、infoAll、report、error

这三个方法是 Aegis 提供的主要上报手段。

```javascript
aegis.info(
  '上报一条白名单日志，这两种情况这条日志才会报到后台：1、打开页面的用户在名单中；2、对应的页面发生了错误🤨',
)

aegis.infoAll('上报了一条日志，该上报与info唯一的不同就在于，所有用户都会上报')

aegis.error(new Error('主动上报一个错误'))

// report 默认是 aegis.report 的日志类型，但是现在你可以传入任何日志类型了
aegis.report({
  msg: '这是一个ajax错误日志',
  level: Aegis.logType.AJAX_ERROR,
  ext1: 'ext1',
  ext2: 'ext2',
  ext3: 'ext3',
  // 上报的ext4-10需要在控制台配置映射表，上报的内容如果不在映射表内会被改写为undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
  trace: 'trace',
})
```

‼️ext1-ext3为`字符串`类型，`限制长度为1024个字节`
‼️ext4-ext10为`字符串`类型，需要在控制台`配置映射表`
‼️msg长度`限制为10KB`

info vs infoAll

1. 使用 “infoAll ” 所有用户都上报，方便排查问题。但是也会带来一定的上报和存储成本。
2. 使用 “info” 白名单上报。出了问题，可能会缺少关键路径日志。需要添加白名单，重新操作收集日志（类似于染色系统操作）。

### reportEvent

该方法可用来上报自定义事件，平台将会自动统计上报事件的各项指标，诸如：PV、平台分布等...

reportEvent 可以支持两种类型上报参数类型，一种是字符串类型

```javascript
aegis.reportEvent('XXX请求成功')
```

一种是对象类型，ext1 ext2 ext3 ext4 ext5 ext6 ext7 ext8 ext9 ext10默认使用 new Aegis 的时候传入的参数，自定义事件上报的时候，可以覆盖默认值。

```javascript
aegis.reportEvent({
  name: 'XXX请求成功', // 必填
  ext1: '额外参数1',
  ext2: '额外参数2',
  ext3: '额外参数3',
  // 上报的ext4-10需要在控制台配置映射表，上报的内容如果不在映射表内会被改写为undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
})
```

注意，额外参数的 key 是固定的，目前只支持 ext1 ext2 ext3 ext4 ext5 ext6 ext7 ext8 ext9 ext10。

‼️ext1-ext3为`字符串`类型，`限制长度为1024个字节`
‼️ext4-ext10为`字符串`类型，需要在控制台`配置映射表`

### reportTime

该方法可用来上报自定义测速，例如：

```javascript
// 假如‘onload’的时间是1s
aegis.reportTime('onload', 1000)
```

或者如果需要使用额外参数，可以传入对象类型参数，ext1，ext2，ext3 会覆盖默认值：

```javascript
aegis.reportTime({
  name: 'onload', // 自定义测速名称
  duration: 1000, // 自定义测速耗时(0 - 60000)
  ext1: 'test1',
  ext2: 'test2',
  ext3: 'test3',
  // 上报的ext4-10需要在控制台配置映射表，上报的内容如果不在映射表内会被改写为undefined
  ext4: 'ext4',
  ext5: 'ext5',
  ext6: 'ext6',
  ext7: 'ext7',
})
```

> `onload` 可以修改为其他的命名。

### time、timeEnd

该方法同样可用来上报自定义测速，适用于两个时间点之间时长的计算并上报，例如：

```javascript
aegis.time('complexOperation')
/**
 * .
 * .
 * 做了很久的复杂操作之后。。。
 * .
 * .
 */
aegis.timeEnd('complexOperation') /** 此时日志已经报上去了😄**/
```

> `complexOperation` 同样可以修改为其他的命名。
> 自定义测速是用户上报任意值，服务端对其进行统计和计算，因为服务端不能做脏数据处理，因此建议用户在上报端进行统计值限制，防止脏数据对整体产生影响。
> 目前 Aegis 只支持 0-60000 的数值计算，如果大于该值，建议进行合理改造。
> 高频率的自定义测速上报尽量使用 reportTime。time 和 timeEnd 上报会存在上报值覆盖的问题。比如 aegis.time(aaa), 在调用 aegis.timeEnd(aaa) 之前，又调用了一次 aegis.time(aaa), 则上报的时间为 timeEnd 时间 - 第二次 time 的时间。

### destroy

该方法用于销毁 sdk 实例，销毁后，不再进行数据上报

```javascript
aegis.destroy()
```

## 白名单

白名单功能是适用于开发者希望对某些特定的用户上报更多的日志，但是又不希望太多上报来影响到全部日志数据，并且减少用户的接口请求次数，因此 TAM 设定了白名单的逻辑。

1. 白名单用户会上报全部的 API 请求信息，包括接口请求和请求结果。
2. 白名单用户可以使用 info 接口上报数据。
3. info vs infoAll：在开发者实际体验过程中，白名单用户可以添加更多的日志，并且使用 info 进行上报。infoAll 会对所有用户无差别进行上报，因此可能导致日志量上报巨大。
4. 通过接口 whitelist 来判断当前用户是否是白名单用户，白名单用户的返回结果会绑定在 aegis 实例上 (aegis.isWhiteList) 用来给开发者使用。
5. 用了减少开发者使用负担，白名单用户是团队有效，可以在 [应用管理-白名单管理](https://console.cloud.tencent.com/rum/web/group-whitelist-manage) 内创建白名单，则团队下全部项目都生效。

## 钩子函数

### beforeRequest

该钩子将会在日志上报前执行，用于对上报数据的拦截和修改，通过返回不同类型的值：

- 拦截：返回false
- 修改：修改入参的值并返回

```javascript
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  //...其他配置
  beforeRequest: function (data) {
    // 入参 data 的数据结构：{logs: {…}, logType: "log"}
    if (data.logType === 'log' && data.logs.msg.indexOf('otheve.beacon.qq.com') > -1) {
      // 拦截：日志类型为 log，且内容包含 otheve.beacon.qq.com 的请求
      return false
    }
    // 入参 data 数据结构：{logs: {}, logType: "speed"}
    if (data.logType === 'speed' && data.logs.url.indexOf('otheve.beacon.qq.com') > -1) {
      // 拦截：日志类型为 speed，并且接口 url 包含 otheve.beacon.qq.com 的请求
      return false
    }
    if (data.logType === 'performance') {
      // 修改：将性能数据的首屏渲染时间改为2s
      data.logs.firstScreenTiming = 2000
    }
    return data
  },
})
```

其中，`msg` 将会有以下几个字段：

> 1.`logs`: 上报的日志内容;

> 2.`logType`: 日志类型

logType等于`custom`时，logs的值如下：

```sh
{name: "白屏时间", duration: 3015.7000000178814, ext1: '', ext2: '', ext3: '', from: ''}
```

logType等于`event`时，logs的值如下：

```sh
{name: "ios", ext1: "", ext2: "", ext3: ""}
```

logType等于`log`时，logs的值如下：

```sh
{ level: '1', msg: '接口请求日志（白名单日志）' } // 具体level信息参考日志等级
```

logType等于`performance`时，logs的值如下：

```sh
{contentDownload: 2, dnsLookup: 0, domParse: 501, firstScreenTiming: 2315, resourceDownload: 2660, ssl: 4, tcp: 4, ttfb: 5}
```

logType等于`speed`时，logs的值如下：

```sh
// 静态资源
{connectTime: 0, domainLookup: 0, duration: 508.2, nextHopProtocol: "", isHttps: true, method: "get", status: 200, type: "static", url: "https://puui.qpic.cn/xxx", urlQuery: "max_age=1296000"}

// API
{duration: 26, isErr: 0, isHttps: true, method: "GET", nextHopProtocol: "", ret: "0", status: 200, type: "fetch", url: "https://xx.com/cgi-bin/whoami"}
```

logType等于`vitals`时，logs的值如下：

```sh
{CLS: 3.365504747991234, FCP: 139.39999997615814, FID: -1, LCP: 127.899}
```

### modifyRequest

该钩子函数会在所有请求发出前调用，参数中会传入请求的所有内容，必须返回待发送内容。

```javascript
function changeURLArg(url, arg, arg_val) {
  var pattern = arg + ' = ([^&]*)'
  var replaceText = arg + '=' + arg_val
  if (url.match(pattern)) {
    var tmp = '/(' + arg + '=)([^&]*)/gi'
    tmp = url.replace(eval(tmp), replaceText)
    return tmp
  }
  return url
}
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  //...其他配置
  modifyRequest(options) {
    if (options.type === 'performance') {
      // 页面测速，此时可以修改options内容，如修改页面测速platform
      options.url = changeURLArg(options.url, 'platform', type)
    }
    return options
  },
})
```

### afterRequest

该勾子将会在数据上报后被执行，例如：

```javascript
const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  //...其他配置
  afterRequest: function (msg) {
    // {isErr: false, result: Array(1), logType: "log", logs: Array(4)}
    console.log(msg)
  },
})
```

其中，`msg` 将会有以下几个字段：

> 1.`isErr`: 请求上报接口是否错误；

> 2.`result`: 上报接口的返回结果；

> 3.`logs`: 上报的日志内容;

> 4.`logType`: 日志类型，有以下值speed：接口和静态资源测速，performance：页面测速，vitals：web vitals，event：自定义事件，custom：自定义测速;

## 错误监控

::: warning
Aegis 的实例在初始化之后会自动进行以下监控

1. JS执行错误
2. Promise执行错误
3. 资源加载失败

开启 `reportApiSpeed` 参数后，会自动监听以下异常

1. Ajax（Fetch）请求异常
2. retcode异常

开启 `websocketHack` 参数后，会自动监听 websocket 执行异常

注意！是 Aegis 实例会进行监控，当您只是引入了 SDK 而没有将其实例化时，Aegis 将什么都不会做。
:::

### JS执行错误

Aegis 通过监听 `window` 对象上的 `onerror` 事件来获取项目中的报错，并且通过解析错误和分析堆栈，将错误信息自动上报到后台服务中。该上报的上报等级为 error ，所以，当自动上报的错误达到阈值时，Aegis 将会自动告警，帮助您尽早发现异常。由于上报等级为 error ，自动上报也将影响项目的评分。

> 如果页面上引入了跨域的JS脚本，需要给对应的 `script` 标签添加 `crossorigin` 属性，否则 Aegis 将无法获取详细的错误信息，参考 [这篇文章](http://km.oa.com/group/11800/articles/show/386426)

注意如果用户使用的是 vue 框架，请务必自己获取错误并且主动上报

```javascript
Vue.config.errorHandler = function (err, vm, info) {
  console.log(`Error: ${err.toString()}\nStack: ${err.stack}\nInfo: ${info}`)
  aegis.error(`Error: ${err.toString()}\nStack: ${err.stack}\nInfo: ${info}`)
}
```

### Promise执行错误

通过监听 `unhandledrejection` 事件，捕获到未被 `catch` 的Promise错误，为了页面的健壮，建议您 `catch` 住所有的Promise错误哟。

### 资源加载失败

页面元素发出的请求如果失败，将会被 `window.onerror` 事件捕获到（捕获阶段），Aegis 正是通过这个特性监听的资源加载失败。Aegis监听了以下资源：

1. `<link>` 标签请求的css、font等；
2. `<script>` 标签请求的脚本；
3. `<audio>`、`<video>` 标签请求的多媒体资源；

### Ajax（Fetch）请求异常

当用户开启 `reportApiSpeed` 参数后，Aegis 将会改写 `XMLHttpRequest` 对象和 `fetch` 对象，监听每次接口请求，Aegis 认为以下情况是异常情况：

1. `http status` 大于等于 400
2. 请求超时，abort，跨域，cancel
3. 请求结束时 `http status` 仍然是 0，通常发生于请求失败

注意： Aegis SDK 在错误发生的时候，不会主动收集接口请求参数和返回信息，如果需要对进口信息进行上报，可以使用 api 参数里面的 apiDetail 进行开启。

```javascript
new Aegis({
  id: '',
  //...其他配置
  reportApiSpeed: true,
  api: {
    apiDetail: true,
  },
})
```

### retcode异常

当用户开启 `reportApiSpeed` 参数后 Aegis 改写 `XMLHttpRequest` 对象和 `fetch` 对象，将获得API返回的内容，并尝试在内容中获取到本次请求的 `retcode`。

> retcode 的值会从用户返回 response body 的第一层（如果第一层取不到，再取第二层）的 code、ret、retcode、errcode 中获取。
> Aegis 默认 retcode 的值为0是正常的，非0都是异常的。当 `retcode` 发生异常的时候，会上报一个 retcode异常的日志。
> 用户可以通过 api.retCodeHandler 对这个值和是否异常进行修正。

### websocket异常

Aegis 默认不会对全局 websocket 对象进行重写，默认不会监控 websocket 相关错误，如果需要打开相关功能可以在创建 Aegis 对象时设置 `websocketHack: true`。

```javascript
new Aegis({
  id: '',
  //...其他配置
  websocketHack: true,
})
```

## 性能监控

### 页面测速

> 打开方式：默认开启

Aegis 实例默认会上报以下指标：

**1. DNS查询**：domainLookupEnd - domainLookupStart；  
**2. TCP连接**：connectEnd - connectStart；  
**3. SSL建连**：requestStart - secureConnectionStart；  
**4. 请求响应**：responseStart - requestStart；  
**5. 内容传输**：responseEnd - responseStart；  
**6. DOM解析**：domInteractive - domLoading；  
**7. 资源加载**：loadEventStart - domInteractive；  
**8. 首屏耗时**：监听页面打开3s内的 **首屏** DOM 变化，并认为 DOM 变化数量最多的那一刻为首屏框架渲染完成时间（sdk初始化后setTimeout 3s收集首屏元素，由于js是在单线程环境下执行，收集时间点可能大于3s，如果第一次3s内无法获取首屏，将会继续计算下一次3s内的元素变化，且只会再计算一次）；  
**9. 页面完加载时间**： 为前面7项数据之和；

> 前7项计算材料从 [PerformanceTiming](https://developer.mozilla.org/en-US/docs/Web/API/Performance/timing) 获取。首屏耗时对应的 dom 元素，可以通过打印 aegis.firstScreenInfo 查看。如果 dom 元素不能代表首屏，可以添加属性 \<div `aegis-first-screen-timing`>>\>\<\/div\>，把某个元素识别为首屏关键元素，SDK 认为只要用户首屏出现此元素就是首屏完成。也可以添加属性 \<div `aegis-ignore-first-screen-timing`>>\>\<\/div\>，把该 dom 列入黑名单。

根据以上数据，TAM 为用户绘制了页面加载瀑布图

![页面加载瀑布图](https://nowpic.gtimg.com/feeds_pic/kZXyd7Yh5phaicL6rEVF6T6WqpmEnWrABkff3anQHeGs/)

> 在服务端直出场景，瀑布图会出现首屏时间大于dom解析的情况，这是由于移动端设备兼容性问题，有些设备无法获取到DNS查询、TCP连接、SSL建连时间，这三个指标汇总后的平均值偏小，导致除了首屏时间外的其他指标都往左偏移。

### 接口测速

> 打开方式：初始化时传入配置 `reportApiSpeed: true`

Aegis 通过劫持 `XHR` 及 `fetch` 进行接口测速，具体代码在 [这里](https://git.woa.com/tam/aegis-sdk/blob/master/packages/web-sdk/src/plugins/cgi-speed.ts)

### 资源测速

> 打开方式：初始化时传入配置 `reportAssetSpeed: true`

Aegis 通过浏览器提供的 `PerformanceResourceTiming` 进行资源测速，具体代码在 [这里](https://git.woa.com/tam/aegis-sdk/blob/master/packages/web-sdk/src/plugins/asset-speed.ts)

### jsBridge 接口测速

Aegis 通过劫持业务中使用的 jsBridge 对象及相关方法来进行bridge接口测速。

> 打开方式：初始化时传入配置:
> `reportBridgeSpeed: true;`
> `h5Bridge: h5BridgeObj`
> `h5BridgeFunc: ['func1', 'func2']`

bridge接口测速是sdk对h5Bridge对象上的h5BridgeFunc进行拦截并重写，这个h5Bridge对象需要由业务自定义传入（通常为客户端挂载在window对象上的jsBridge对象），h5BridgeFunc表示需要拦截并重写的h5Bridge上具体的方法列表。

## 环境控制

> aegis 默认把数据所在环境当作 `production` 进行上报，如果您有自助修改的需求的话，可以使用 env 参数进行修改。

```javascript
new Aegis({
  id: '',
  //...其他配置
  env: Aegis.environment.gray,
})
```

Aegis.environment 枚举值如下

```javascript
export enum Environment {
  production = 'production', // 生产环境
  gray = 'gray', // 灰度环境
  pre = 'pre', // 预发布环境
  daily = 'daily', // 日发布环境
  local = 'local', // 本地环境
  test = 'test', // 测试环境
  others = 'others' // 其他环境
}
```

修改 env 参数后，aegis 上报的数据都会带上该参数，方便开发者区分不同环境的数据，但是只有 production 环境的数据会参与项目得分的计算。

## 离线日志 （目前已经下线）

## 浏览器指纹

Aegis指纹版SDK使用浏览器指纹算法作为用户唯一标识aid，提升uv准确率；用户通过引用指纹版Aegis SDK就可以使用

> IE浏览器兼容版本：>= `IE11`

1. 引入指纹版SDK

cdn 引入

```html
<script src="https://tam.cdn-go.cn/aegis-sdk/latest/aegis.f.min.js"></script>
```

npm 引入：

```sh
$ npm install aegis-web-sdk
```

```javascript
import Aegis from '@tencent/aegis-web-sdk/lib/aegis.f.min'
```

> 备注：version > 1.38.56

2. 查看uv

![监听用户](https://tam-1258344699.cos.ap-guangzhou.myqcloud.com/tam-image/%E4%BC%81%E4%B8%9A%E5%BE%AE%E4%BF%A1%E6%88%AA%E5%9B%BE_d3fafaa2-6511-423f-8577-851d77a39ee1.png)

3. 更多应用场景

与此同时，配合业务场景进行技术赋能，可以扩展出更多能力。如安全部门基于指纹SDK扩展出安全审计功能等。

4. 指纹算法简介

人的指纹千变万化，具有唯一性，可以作为人的身份标识。类似的，浏览器指纹是通过获取浏览器具有辨识度的信息，进行一些计算得出一个值，那么这个值就是浏览器指纹。

浏览器指纹是由许多浏览器的特征信息综合起来的，其中特征值的信息熵也不尽相同。因此，指纹也分为基本指纹和高级指纹。**基本指纹**是任何浏览器都具有的特征标识，比如硬件类型（Apple）、操作系统（Mac OS）、用户代理（User agent）、系统字体、语言、屏幕分辨率、浏览器插件 (Flash, Silverlight, Java, etc)等众多信息，这些指纹信息“类似”人类的身高、年龄等，有很大的冲突概率，只能作为辅助识别。普通指纹是不够区分独特的个人，这时就需要**高级指纹**，将范围进一步缩小，甚至生成一个独一无二的浏览器身份。常见的有：Canvas指纹、Webgl指纹、audio指纹等。

在指纹版Aegis SDK中，也引入了多种业界成熟的基础/高级指纹，设备识别准确度的提升显著。我们以Canvas为例，来展开介绍下指纹算法的实现思路。

由于系统的差别，Canvas底层的图形渲染引擎不同，对抗锯齿、次像素渲染等算法也不同；我们通过在画布上渲染一些文字，再用 toDataURL 转换输出一段字符串，这就生成了代表设备唯一标识的指纹信息。

```javascript
function getCanvasFingerprint() {
  var canvas = document.createElement('canvas')
  var context = canvas.getContext('2d')
  context.font = '18pt Arial'
  context.textBaseline = 'top'
  context.fillText('aegis,sdk <canvas> 1.0', 2, 15)
  return canvas.toDataURL('image/jpeg')
}
```

当然，canvas指纹也有一定的概率发生重复，比如两个设备配置一样时，他们的canvas指纹也是一样的。所以我们还需要结合其他多种指纹算法，生成联合指纹信息串，来将指纹唯一性提升到极致。

> 指纹算法在持续迭代优化中，如需讨论和共建请联系`oliverfan`

## 兼容ie8

Aegis 提供了兼容 `ie8` 的版本啦 🤟🏻🤟🏻

> tnpm 包版本需大于 `1.23.45`  
> cdn 暂未提供，急需请联系 `pumpkincai` 上架

### 安装

```bash
tnpm install --save @tencent/aegis-web-sdk
```

### 使用

```javascript
import Aegis from '@tencent/aegis-web-sdk/lib/aegis.ie.min.js'

function isIE() {
  // 浏览器判断
  // ie return false
  // 非ie return true
}

const aegis = new Aegis({
  id: 'pGUVFTCZyewxxxxx',
  uin: 'xxxx',
  ie: isIE(), // 打开ie布丁插件
  reportAssetSpeed: !isIE(), // ie暂不支持测速
  reportApiSpeed: !isIE(), // ie暂不支持测速
  onError: !isIE(), // 关闭高版本错误监控
  pagePerformance: !isIE(), // 关闭默认打开的页面测速（ie暂不支持）
})
```

### TIPS

`ie8` 版本的 SDK 跟普通的对比，多了非常多的 polyfill 以及ie专用插件，所以体积稍大（gzip 24kb）。

## 配置文档

| 配置              | 描述                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                | 必须，string，默认 无。<br>开发者平台分配的项目ID                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| uin               | 建议，string，默认取 cookie 中的 uin 字段。<br>业务定义的当前用户的唯一标识符，用来查找固定用户的日志。白名单上报时将根据该字段判定用户是否在白名单中，字段仅支持`字母数字@=._-`，正则表达式: `/^[@=.0-9a-zA-Z_-]{1,60}$/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| reportApiSpeed    | 可选，boolean 或者 <span id="jump">[object](#exp2)</span>，默认 false。<br>是否开启接口测速                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| reportBridgeSpeed | 可选，boolean，默认 false。<br>是否开启 jsbridge 监控上报                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| reportAssetSpeed  | 可选，boolean，默认 false。<br>是否开启静态资源测速                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| pagePerformance   | 可选，boolean 或者 <span id="jump">[object](#exp3)</span>，默认 true。<br>是否开启页面测速                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| webVitals         | 可选，boolean 或者 <span id="jump">[object](#exp6)</span>，默认 true。<br>是否开启 web vitals 测速。当设置为对象时，可配置 `manualReport: true` 来手动控制上报时机，此时需要调用 `aegis.reportWebVitals(customData?)` 方法来触发上报。支持传入自定义的 Web Vitals 数据，如果不传则使用 SDK 采集的数据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| consoleLog        | 可选，boolean，默认 false。<br>是否采集console日志上报为日志                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| clickElementLog   | 可选，boolean，默认 false。<br>是否采集点击事件上报为日志                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ignoreElements    | 可选，{"ignoreClasses": string[], "ignoreIds": string[]}，<br>例如 { "ignoreClasses": ["address-box","school-box"], "ignoreIds": ["phone-num-card","name-card"]},<br>忽略的元素的class和id，用于过滤掉不需要上报的元素，例如用户的个人信息输入框等                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| slowApiLog        | 可选，boolean，默认 false。<br>是否采集慢的api请求数据上报为日志,慢的标准是请求耗时超过1000ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| pageLoadLog       | 可选，boolean，默认 false。<br>是否采集正常的页面加载数据上报为日志                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| slowPageLoadLog   | 可选，boolean，默认 false。<br>是否采集慢的页面加载数据上报为日志,慢的标准是fmp超过1000ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| assetLog          | 可选，boolean，默认 false。<br>是否采集正常资源请求上报为日志,这个开关设置为true后，仍然还需要去页面中把用户添加为白名单用户，才会采集正常的api请求                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| slowAssetLog      | 可选，boolean，默认 false。<br>是否采集慢的资源请求上报为日志,慢的标准是请求耗时超过1000ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| onError           | 可选，boolean，默认 true。<br>当前实例是否需要进行错误监听，获取错误日志                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| aid               | 可选，boolean，默认 true。<br>当前实例是否生成aid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| random            | 可选，number，默认 1。<br>0~1 抽样率                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| spa               | 可选，boolean，默认 false。 <br> 当前页面是否是单页应用？true的话将会监听hashchange及history api，在页面跳转时进行pv上报                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| pageUrl           | 可选。默认是 location.href。 <br> 修改上报数据中页面地址，开发者可以主动对数据进行聚合和降低维度 ｜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| urlHandler        | 可选，Function。 <br> 动态修改上报数据中页面地址 from，可以配合 pageUrl 参数使用 <span id="jump">[见示例[5]](#exp5)</span> ｜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| version           | 可选，string，默认 sdk 版本号。<br>当前上报版本，当页面使用了pwa或者存在离线包时，可用来判断当前的上报是来自哪一个版本的代码，仅支持`字母数字.,:_-`，长度在 60 位以内 `/^[0-9a-zA-Z.,:_-]{1,60}$/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| reportImmediately | 可选，boolean，默认 true。<br>采集完数据后是否立即上报，默认为 true，如果设置为 false，则只采集数据，不触发数据上报，需要业务主动调用 aegis.ready() 方法才能触发上报，该参数一般用于业务有异步上报诉求的场景（例如预加载）。当 Aegis 初始化的时候，无法获取到正确的 uin，但是开发者希望上报 pv 的时候都带上 uin 数据，也可以用此参数控制获取 uin 后再执行 ready 方法，可以配合 setConfig 去设置 uin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| delay             | 可选，number，默认 1000 ms。<br>上报节流时间，在该时间段内的上报将会合并到一个上报请求中。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| repeat            | 可选，number，默认 5。<br>重复上报次数，对于同一个错误或者同一个接口测速超过多少次不上报。如果传入 repeat 参数为 0，则不限制。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| env               | 可选，enum，默认 Aegis.environment.production。 <br> 当前项目运行所处的环境。｜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| websocketHack     | 可选，boolean，默认 false <br>是否开启websocket监控。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| blankScreen       | 可选，boolean，默认 false。<br>是否开启白屏监控                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| api               | 可选，object，默认为 {}。相关的配置: <br> apiDetail : 可选，boolean，默认false。上报 api 信息的时候，是否上报 api 的请求参数和返回值; <br><br> retCodeHandler: Function(data: String, url: String, xhr: Object):{isErr: boolean, code: string}， 返回码上报钩子函数。 会传入接口返回数据,请求url和xhr对象; <br><br> reqParamHandler: Function(data: any, url: String) 上报请求参数的处理函数，可以对接口的请求参数进行处理，方便用户过滤上报请求参数的信息; <br><br> resBodyHandler: Function(data: any, url: String) 上报 response 返回 body 的处理函数，可以对接口返回值的 response body 进行处理，只上报关键信息; <br><br> reqHeaders: Array 需要上报的 http 请求 request headers 列表。 <br><br> resHeaders: Array 需要上报的 http 请求 response headers 列表。注意使用小写。 如果开发者需要获取的字段非 “simple response header”，需要给在返回头中给字段添加 Access-Control-Expose-Headers <br><br> resourceTypeHandler: Function，请求资源类型修正钩子函数 会传入接口url，返回值为‘static’或‘fetch’。<span id="jump">[见示例[1]](#exp1)</span> <br><br> reportRequest: boolean, 默认为false。 开启aegis.info全量上报, 不需要白名单配置。并上报所有接口请求信息（请开启reportApiSpeed）<br><br> usePerformanceTiming: boolean，默认为false。aegis sdk 默认使用打点的方式计算接口耗时，该方式在移动端存在一些误差，开启 usePerformanceTiming 后，aegis sdk 会从 performance 中重新获取接口耗时，让接口耗时统计更为准确。需要注意的是，开启该参数的前提是用户业务接口请求 url 是独立且唯一的，用户可以在接口请求 url 中添加时间戳等方式来保证 url 唯一性。如果 url 不唯一，可能导致同 url 接口耗时获取错误。<br><br> injectTraceHeader: 可选，string，且必须为枚举值 'traceparent', 'sw8', 'b3', 'sentry-trace' 中的一种，开启该参数后，Aegis 会在用户请求头中注入相关 trace header。<br><br> injectTraceUrls: 可选，Array, 数组中传入 string 或者 RegExp。标记哪些请求 url 需要注入 trace 请求头。 <br><br> injectTraceIgnoreUrls: 可选，Array, 数组中传入 string 或者 RegExp。标记哪些请求 url 不需要注入 trace 请求头。 <br><br> traceFlag: 可选，`boolean` 或 `number`, 标记trace请求的flag设置 |
| speedSample       | 可选，boolean，默认 true。<br>测速日志是否抽样（限制每条url只上报一次测速日志）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| hostUrl           | 可选，默认是 `https://rumt-zh.com`。<br>影响全部上报数据的 host 地址，下面几个 url 地址设置后会覆盖对应的上报地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| url               | 可选，string，默认 'https://rumt-zh.com/collect'。<br>日志上报地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| pvUrl             | 可选，string, 默认 'https://rumt-zh.com/collect/pv' <br> pv 上报地址 ｜                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| whiteListUrl      | 可选，string，默认 'https://rumt-zh.com/collect/whitelist'。<br>白名单确认接口 <br>如果想要关闭白名单接口请求，可以传空字符串                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| offlineUrl        | 可选，string，默认 'https://rumt-zh.com/collect/offline'。<br> 离线日志上报地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| eventUrl          | 可选，string，默认 'https://rumt-zh.com/collect/events'。<br> 自定义事件上报地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| speedUrl          | 可选，string，默认 'https://rumt-zh.com/speed'。<br>测速日志上报地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| customTimeUrl     | 可选，string，默认 'https://rumt-zh.com/speed/custom'。<br>自定义测速上报地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| performanceUrl    | 可选，string，默认 'https://rumt-zh.com/speed/performance'。<br>页面性能日志上报地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| webVitalsUrl      | 可选，string，默认 'https://rumt-zh.com/speed/webvitals'。 <br> webvitals 上报地址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ext1              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext2              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext3              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext4              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext5              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext6              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext7              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext8              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext9              | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ext10             | 可选，string，自定义上报的额外维度，上报的时候可以被覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 示例

**[1] api.retCodeHandler**<span id="exp1"></span>，假如后台返回数据为:

```json
{
  "body": {
    "code": 200,
    "retCode": 0,
    "data": {
      // xxx
    }
  }
}
```

业务需要：code不为200，或者retCode不为0，此次请求就是错误的。此时只需进行以下配置：

```javascript
new Aegis({
  // xxx
  reportApiSpeed: true, // 需要开两个，不然不会有返回码上报
  reportAssetSpeed: true,
  api: {
    // 注意，此处如果用在ie低版本里面，不能用retCodeHandler(){}这种写法，ie不支持
    retCodeHandler: function (data, url, xhr) {
      // 注意这里的 data 的数据类型，跟接口返回值的数据类型一致，开发者需要根据实际情况自行处理
      // fetch 请求的时候，data 是 string，如果需要对象需要手动 parse 下
      // xhr 请求的时候，data 是 xhr.response 拿到完整的后台响应
      try {
        data = JSON.parse(data)
      } catch (e) {}
      return {
        isErr: data.body.code !== 200 || data.body.retCode !== 0,
        code: data.body.code,
      }
    },
  },
})
```

**api.resourceTypeHandler**，假如接口

`http://example.com/test-api`

返回的 `Content-Type` 为 `text/html`，这将导致 Aegis 认为该接口返回的是静态资源，可以通过以下方法修正：

```javascript
new Aegis({
  reportApiSpeed: true, // 需要开两个，不然不会有返回码上报
  reportAssetSpeed: true,
  api: {
    resourceTypeHandler: function (url) {
      if (url?.indexOf('http://example.com/test-api') != -1) {
        return 'fetch'
      }
    },
  },
})
```

**[2] reportApiSpeed.urlHandler**<span id="exp2"></span>，假如您页面中有restful风格的接口，如：  
*www.example.com/user/1000*  
*www.example.com/user/1001*

在上报测速时需要将这些接口聚合：

```javascript
new Aegis({
  // xxx
  reportApiSpeed: {
    urlHandler(url, payload) {
      if (/www\.example\.com\/user\/\d*/.test(url)) {
        return 'www.example.com/user/:id'
      }
      return url
    },
  },
  // xxx
})
```

**[3] pagePerformance.urlHandler**<span id="exp3"></span>，假如您的页面url是restful风格的，如：  
*www.example.com/user/1000*  
*www.example.com/user/1001*

在上报页面测速时需要将这些页面地址聚合：

```javascript
new Aegis({
  // xxx
  pagePerformance: {
    urlHandler() {
      if (/www\.example\.com\/user\/\d*/.test(window.location.href)) {
        return 'www.example.com/user/:id'
      }
    },
  },
  // xxx
})
```

**[4] pagePerformance.firstScreenInfo**<span id="exp4"></span>，默认值为 false，如果需要在内存中保留 aegis.firstScreenInfo 对象，可以通过设置改值为 true 来实现。

```javascript
new Aegis({
  // xxx
  pagePerformance: {
    firstScreenInfo： true
  }
  // xxx
})
```

**[5] urlHandler**<span id="exp5"></span>，修改上报接口中的 from 参数，用来降低页面地址的维度信息，避免维度限制导致用户数据丢失。按优先级从urlHandler/pageUrl/location.href 获取，默认为location.href。

该方法既可以减少一些敏感信息，又可以全体上报数据的整体维度信息。

```javascript
new Aegis({
  pageUrl: location.href,
  urlHandler() {
    // 比如页面地址为 'aaaa.com/123123/user'，通过下面的修改后会变成 aaa.com/*/user
    return location.href.replace(/\d+\//, '*')
  },
})
```

**[6] webVitals.manualReport**<span id="exp6"></span>，手动控制 Web Vitals 数据的上报时机。默认情况下，Web Vitals 数据会在页面隐藏时自动上报。如果需要自定义上报时机，可以设置 `manualReport: true`，然后在合适的时机调用 `aegis.reportWebVitals()` 方法。

```javascript
const aegis = new Aegis({
  id: 'your-project-id',
  // 开启手动上报模式
  webVitals: {
    manualReport: true,
  },
})

// 方式 1：使用 SDK 采集的数据
aegis.reportWebVitals()

// 方式 2：使用完全自定义的数据
aegis.reportWebVitals({
  FCP: 1800,
  LCP: 2500,
  FID: 100,
  CLS: 0.1,
  INP: 200,
  TTI: 3000,
})

// 方式 3：部分自定义（推荐）
// 只覆盖指定字段，其他字段使用 SDK 采集的数据
aegis.reportWebVitals({
  LCP: 2500, // 自定义 LCP
  FCP: 1800, // 自定义 FCP
  // 其他字段使用 SDK 采集的数据
})

// 在需要上报的时候调用
// 例如：在用户点击某个按钮时、在路由切换时、或在其他业务逻辑完成时
document.getElementById('reportBtn').addEventListener('click', () => {
  aegis.reportWebVitals()
})

// 或者在 SPA 路由切换时上报
router.afterEach(() => {
  aegis.reportWebVitals()
})
```

**[6] webVitals.manualReport**<span id="exp6"></span>，手动控制 Web Vitals 数据的上报时机。默认情况下，Web Vitals 数据会在页面隐藏时自动上报。如果需要自定义上报时机，可以设置 `manualReport: true`，然后在合适的时机调用 `aegis.reportWebVitals()` 方法。

```javascript
const aegis = new Aegis({
  id: 'your-project-id',
  // 开启手动上报模式
  webVitals: {
    manualReport: true,
  },
})

// 在需要上报的时候调用
// 例如：在用户点击某个按钮时、在路由切换时、或在其他业务逻辑完成时
document.getElementById('reportBtn').addEventListener('click', () => {
  aegis.reportWebVitals()
})

// 或者在 SPA 路由切换时上报
router.afterEach(() => {
  aegis.reportWebVitals()
})
```
