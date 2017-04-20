# AQI-API

本项目配合[Air_Of_China](https://github.com/InLefter/Air_Of_China)爬取的全国城市空气质量发布平台上空气质量数据，提供一些简单的 API接口。

## ENVIROMENT
nodejs v6.10.1
使用前请安装这两个模块
`npm install redis mysql moment async --save`

## INTRODUCTION
服务启动默认为localhost的3000端口，服务器部署可以使用nginx反代理至本地3000端口，比较方便。



http全为POST请求方式，写了以下几种方式：

```http
# 通过经纬度获取最近的站点以及城市的最新信息
# 由于只收集了国内的空气质量数据，所以国外的经纬度获得的信息是不准确的（暂时未# 做排除处理）。
path: /api/latest
headers: {Content-Type: application/x-www-form-urlencoded}
body: {lat: 33.112233, lon: 118.112233}
```

```http
# 获取站点最新信息
path: /api/site/latest
headers: {Content-Type: application/x-www-form-urlencoded}
body: {SiteID: 1110A}
```

```http
# 获取城市最新信息
path: /api/city/latest
headers: {Content-Type: application/x-www-form-urlencoded}
body: {CityID: 110000}
```

```http
# 获取城市所有站点的最新信息
path: /api/city/allsites
headers: {Content-Type: application/x-www-form-urlencoded}
body: {CityID: 110000}
```

```http
# 获取站点最近24小时信息
path: /api/site/24h
headers: {Content-Type: application/x-www-form-urlencoded}
body: {SiteID: 1110A}
```



城市ID：info/city_info.xml

站点ID：info/site_info.xml