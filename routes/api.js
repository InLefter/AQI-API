/**
 * Created by howie on 2017/3/6.
 */

var express = require('express');
var redis = require('redis');
var mysql = require('mysql');
var moment = require('moment');
var async = require('async');
var http = require('http');
var qs = require('querystring');

var router = express.Router();

var client = redis.createClient('6379','127.0.0.1');

var mysqlPool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'zh20110612',
    database: 'AQI'
});

client.on("error", function (error) {
    console.log(error);
});

//各空气质量等级的建议
air_me = {'优':{'measure':'各类人群可正常活动','unhealthful':'空气质量令人满意，基本无空气污染'},
    '良':{'measure':'极少数异常敏感人群应减少户外活动','unhealthful':'空气质量可接受，但某些污染物可能对极少数异常敏感人群健康有较弱影响'},
    '轻度污染':{'measure':'儿童、老年人及心脏病、呼吸系统疾病患者应减少长时间、高强度的户外锻炼','unhealthful':'易感人群症状有轻度加剧，健康人群出现刺激症状'},
    '中度污染':{'measure':'儿童、老年人及心脏病、呼吸系统疾病患者应减少长时间、高强度的户外锻炼，一般人群适量减少户外活动','unhealthful':'进一步加剧易感人群症状，可能对健康人群心脏、呼吸系统有影响'},
    '重度污染':{'measure':'老年人及心脏病、肺病患者应停留在室内，停止户外活动，一般人群减少户外活动','unhealthful':'心脏病和肺病患者症状显著加剧，运动耐力降低，健康人群普遍出现症状'}}


// get city name and id
mysqlPool.getConnection(function (err, connection) {
    connection.query("select * from city_info", function (err, rows) {
        connection.release();
        if (rows){
            for (var i = 0; i < rows.length; i++){
                client.set('s' + rows[i].cityID, rows[i].cityName);
                client.set('ut_' + rows[i].cityName, rows[i].cityID);
            }
        }
    });
});

// get site info
mysqlPool.getConnection(function (err, connection) {
    connection.query("select * from site_info", function (err, rows) {
        connection.release();
        if (rows){
            for (var i = 0; i < rows.length; i++){
                client.hmset('s'+rows[i].siteID,"SiteName",rows[i].siteName,
                    "City",rows[i].city, "Latitude",rows[i].Latitude, "Longitude", rows[i].Longitude);
                client.sadd(rows[i].city+'_sites',rows[i].siteID);
            }
        }
    });
});

// Test Area
// 搜索

// 省份搜索
// req {pid: xx}
router.post('/search/province', function (req, res) {
    var pid = req.body['pid'];
    res.setHeader("Content-Type", "application/json");
    client.get("province_" + pid, function (err, result) {
        if (result !== null) {
            res.send('{ "ProvinceID": '+pid+',"Detail": '+ result + '}');
        } else {
            res.send('{"error_info": ' + '"There are something wrong happened in servers"' + '}');
        }
    })
});

// 城市搜索
// req {CityID: xx}
router.post('/search/city', function (req, res) {
    var cityID = req.body['CityID'];
    res.setHeader("Content-Type", "application/json");
    client.get("city_" + cityID, function (err, result) {
        if (result !== null) {
            res.send('{ "CityID": '+cityID+',"Detail": '+ result + '}');
        } else {
            res.send('{"error_info": ' + '"There are something wrong happened in servers"' + '}');
        }
    })
});

// 站点实时信息
// req {SiteID: xx, SiteName: xx}
router.post('/site/latest', function (req, res) {
    var siteID = req.body['SiteID'];
    res.setHeader("Content-Type", "application/json");
    client.get(siteID, function (err, result) {
        if (err) {
            res.send('{"error_info": '+'"There are something wrong happened in servers"'+'}');
        } else if (result !== null) {
            // reply['SiteName'] = site;
            res.send(result);
        } else {
            var time = moment(Date.now());
            var nowDay = time.format('D');
            var nowYD = time.format('YYYYMM');
            var nowTime = time.format('YYYY-MM-DD HH') + ':00:00';

            var site_sql = "select * from site_table_"+nowYD+" partition (p"+nowDay+") where time = '"+nowTime+"' && siteID = '";

            mysqlPool.getConnection(function (err, connection) {
                connection.query(site_sql+siteID+"'", function (err, reply, fields) {
                    connection.release();
                    if (!isObjectEmpty(reply)) {
                        var temp_dict = reply[0];
                        client.hmget('s'+siteID, 'City', 'Latitude', 'Longitude', function (err, other) {
                            temp_dict['Area'] = other[0];
                            temp_dict['Latitude'] = other[1];
                            temp_dict['Longitude'] = other[2];

                            var qua = temp_dict['Quality'];
                            if ( qua !== '—') {
                                temp_dict['Measure'] = air_me[qua]['measure'];
                                temp_dict['Unhealthful'] = air_me[qua]['unhealthful'];
                            } else {
                                temp_dict['Measure'] = '—';
                                temp_dict['Unhealthful'] = '—';
                            }
                            temp_dict['StationCode'] = siteID;
                            temp_dict['Time'] = nowTime;
                            var json = JSON.stringify(temp_dict);
                            res.send('{"StationID": "'+siteID+'", "Detail": '+json+'}');

                            client.set(siteID, json);
                        });
                    }
                });
            });
        }
    });
});


// 经纬度计算最近站点
router.post('/latest', function (req, res) {
    var lat = req.body['lat'];
    var lon = req.body['lon'];
    var content = qs.stringify({
        location: lat + ',' + lon,
        output: 'json',
        ak: 'C9a3e2326054abae5794bd20c10a81c6'
    });
    var options = {
        host: 'api.map.baidu.com',
        path: '/geocoder/v2/?' + content,
        method: 'GET'
    };

    res.setHeader("Content-Type", "application/json");

    var request = http.request(options, function (response) {
        response.on('data' ,function (chunk) {
            var json = JSON.parse(chunk.toString());
            var city = json.result.addressComponent.city;

            client.smembers(city+'_sites', function (error, results) {
                async.map(results, function (item, callback) {
                    client.hmget('s'+item, "Latitude","Longitude", function (err, re) {
                        dis = Math.pow(re[0] - lat, 2) + Math.pow(re[1] - lon, 2);
                        callback(null, dis);
                    });
                }, function(error, distance){
                    var site_id = results[distance.indexOf(Math.min.apply(null,distance))];
                    var re_json = '';
                    client.get('ut_'+city, function (err, cityID) {
                        client.get(cityID,function (err, cityInfo) {
                            re_json += '{ "nearby": [ '+cityInfo+',';
                            client.get(site_id, function (err, siteInfo) {
                                re_json += siteInfo+']}';
                                res.send(re_json);
                            });
                        });
                    });
                });
            });
        });
    });

    request.on('error', function (error) {
        console.log(error);
    });
    request.end();
});

// 站点最近24小时信息
// req {SiteID: xx, SiteName: xx}
router.post('/site/24h', function (req, res) {
    var siteID = req.body['SiteID'];
    res.setHeader("Content-Type", "application/json");
    client.lrange(siteID+'_24h','0','-1',  function (err, result) {
        if (err) {
            res.send('{"error_info": "There are something wrong happened in servers"}');
        } else if (result !== null) {
            // reply['SiteName'] = site;
            res.send('{"SiteCode" : "'+siteID+'", "Detail": ['+result+']}');
        } else {
            mysqlPool.getConnection(function (err, connection) {
                var time = moment(Date.now());
                var nowDay = time.format('D');
                var nowYD = time.format('YYYYMM');
                var nowTime = time.format('YYYY-MM-DD HH') + ':00:00';
                connection.query("select * from site_table_"+ nowYD+" partition (p"+nowDay+") where time between date_sub(NOW(),interval 1 day) and  NOW()  && siteID = '"+siteID+"'", function (rows) {
                    connection.release();
                    if (!isObjectEmpty(rows)) {
                        async.map(rows, function (item, callback) {
                            var temp = item;
                            client.hmget('s'+siteID, 'City', 'Latitude', 'Longitude', function (err, other) {
                                temp['Area'] = other[0];
                                temp['Latitude'] = other[1];
                                temp['Longitude'] = other[2];
                                temp['StationCode'] = siteID;
                                temp['Measure'] = air_me[temp_dict['Quality']]['measure'];
                                temp['Unhealthful'] = air_me[temp_dict['Quality']]['unhealthful'];
                                temp['Time'] = nowTime;
                                var json = JSON.stringify(temp);
                                callback(null, json);
                            });
                        }, function (err, results) {
                            var data = '{"SiteCode" : '+siteID+', "Detail": ['+results+']}';
                            res.send(data);
                            client.lpush(siteID+'_24h', results);
                            if (client.llen(siteID+'_24h') >= 24) {
                                client.rpop(siteID+'_24h')
                            }
                        });
                    }
                });
            });
        }
    });
});


// 城市所有站点最新信息
// req {CityID: xx, CityName: xx}
// router.post('/city/allsites', function (req, res) {
//     var cityID = req.body['CityID'];
//     res.setHeader("Content-Type", "application/json");
//     client.get(cityID+'_allsite', function (err, result) {
//         if (err) {
//             res.send('{"error_info": '+'"There are something wrong happened in servers"'+'}');
//         } else if (result !== null) {
//             res.send(result);
//         } else {
//             client.get(cityID, function (err, reply) {
//                 var city = reply;
//                 mysqlPool.getConnection(function (err, connection) {
//                     connection.query("select * from site_info where city = '"+city+"'", function (err, rows) {
//                         connection.release();
//                         if (rows) {
//                             var time, nowDay, nowYD, nowTime, site_sql, id;
//
//                             async.map(rows, function (item, callback) {
//                                 mysqlPool.getConnection(function (err, con) {
//                                     time = moment(Date.now());
//                                     nowDay = time.format('D');
//                                     nowYD = time.format('YYYYMM');
//                                     nowTime = time.format('YYYY-MM-DD HH') + ':00:00';
//                                     site_sql = "select * from site_table_"+nowYD+" partition (p"+nowDay+") where time = '"+nowTime+"' && siteID = '";
//                                     id = item.siteID;
//                                     con.query(site_sql+id+"'", function (err, reply) {
//                                         con.release();
//                                         if (!isObjectEmpty(reply)) {
//                                             var temp_dict = reply[0];
//                                             client.hmget('s'+id, 'City', 'Latitude', 'Longitude', function (err, other) {
//                                                 temp_dict['Area'] = other[0];
//                                                 temp_dict['Latitude'] = other[1];
//                                                 temp_dict['Longitude'] = other[2];
//                                                 temp_dict['StationCode'] = id;
//                                                 temp_dict['Measure'] = air_me[temp_dict['Quality']]['measure'];
//                                                 temp_dict['Unhealthful'] = air_me[temp_dict['Quality']]['unhealthful'];
//                                                 temp_dict['Time'] = nowTime;
//                                                 var json = JSON.stringify(temp_dict);
//                                                 callback(null, json);
//                                             });
//                                         }
//                                     });
//                                 });
//                             }, function (err, results) {
//                                 var data = '{"CityCode_AllSites" : '+cityID+', "Detail": '+results+'}';
//                                 res.send(data);
//                                 client.set(cityID+'_allsite', data);
//                             });
//                         }
//                     });
//                 });
//             });
//         }
//     });
//
//
// });


// 城市实时信息
// req {CityID: xx, CityName: xx}
router.post('/city/latest', function (req, res) {
    var cityID = req.body['CityID'];
    res.setHeader("Content-Type", "application/json");
    client.get(cityID, function (err, result) {
        if (err) {
            res.send('{"error_info": '+'"There are something wrong happened in servers"'+'}');
        } else if (result !== null) {
            // reply['SiteName'] = site;
            res.send(result);
        } else {
            mysqlPool.getConnection(function (err, connection) {
                var time = moment(Date.now());
                var nowDay = time.format('D');
                var nowYD = time.format('YYYYMM');
                var nowTime = time.format('YYYY-MM-DD hh') + ':00:00';

                var city_rt_sql = "select * from city_rt_table_"+nowYD+" partition (p"+nowDay+") where time = '"+nowTime+"' && siteID = '";
                connection.query(city_rt_sql+cityID+"'", function (err, reply) {
                    connection.release();
                    if (reply) {
                        var temp_dict = reply[0];

                        temp_dict['CityCode'] = cityID;
                        var qua = temp_dict['Quality'];
                        if ( qua != '—') {
                            temp_dict['Measure'] = air_me[qua]['measure'];
                            temp_dict['Unhealthful'] = air_me[qua]['unhealthful'];
                        } else {
                            temp_dict['Measure'] = '—';
                            temp_dict['Unhealthful'] = '—';
                        }
                        temp_dict['Time'] = nowTime;
                        var json = JSON.stringify(temp_dict);
                        res.send('{"CityID": "'+cityID+'", "Detail": '+json+'}');

                        client.set(cityID, json);
                    }
                });
            });
        }
    });
});


// 城市最近三十天信息
// req {CityID: xx, CityName: xx}
router.post('/city/month', function (req, res) {
    var cityID = req.body['CityID'];
    res.setHeader("Content-Type", "application/json");
    client.lrange(cityID+'_month','0','-1', function (err, result) {
        if (err) {
            res.send('{"error_info": "There are something wrong happened in servers"}');
        } else if (result !== null) {
            res.send('{"CityCode" : "'+cityID+'", "Detail": ['+result+']}');
        } else {
            mysqlPool.getConnection(function (err, connection) {
                var time = moment(Date.now());
                var nowDay = time.format('D');
                var nowYD = time.format('YYYYMM');
                var nowTime = time.format('YYYY-MM-DD HH') + ':00:00';
                connection.query("select * from city_table_"+ nowYD+" partition (p"+nowDay+") where time between date_sub(NOW(),interval 1 day) and  NOW()  && cityID = '"+cityID+"'", function (rows) {
                    connection.release();
                    if (!isObjectEmpty(rows)) {
                        async.map(rows, function (item, callback) {
                            var temp = item;
                            client.get('s'+cityID, function (err, result) {
                                temp['cityName'] = result;
                                temp['CityCode'] = cityID;
                                temp['Measure'] = air_me[temp['Quality']]['measure'];
                                temp['Unhealthful'] = air_me[temp['Quality']]['unhealthful'];
                                temp['Time'] = nowTime;
                                var json = JSON.stringify(temp);
                                callback(null, json);
                            })
                        }, function (err, results) {
                            var data = '{"CityCode" : '+cityID+', "Detail": '+results+'}';
                            res.send(data);
                            client.set(cityID+'_month', data);
                        })
                    }
                })
            })
        }
    });
});


// 城市最近24h信息
// req {CityID: xx, CityName: xx}
router.post('/city/24h', function (req, res) {
    var cityID = req.body['CityID'];
    res.setHeader("Content-Type", "application/json");
    client.lrange(cityID+'_24h','0','-1', function (err, result) {
        if (err) {
            res.send('{"error_info": "There are something wrong happened in servers"}');
        } else if (result !== null) {
            res.send('{"CityCode" : "'+cityID+'", "Detail": ['+result+']}');
        } else {
            mysqlPool.getConnection(function (err, connection) {
                var time = moment(Date.now());
                var nowDay = time.format('D');
                var nowYD = time.format('YYYYMM');
                var nowTime = time.format('YYYY-MM-DD HH') + ':00:00';
                connection.query("select * from city_rt_table_"+ nowYD+" partition (p"+nowDay+") where time between date_sub(NOW(),interval 1 day) and  NOW()  && cityID = '"+cityID+"'", function (rows) {
                    connection.release();
                    if (!isObjectEmpty(rows)) {
                        async.map(rows, function (item, callback) {
                            var temp = item;
                            client.get('s'+cityID, function (err, result) {
                                temp['cityName'] = result;
                                temp['CityCode'] = cityID;
                                temp['Measure'] = air_me[temp['Quality']]['measure'];
                                temp['Unhealthful'] = air_me[temp['Quality']]['unhealthful'];
                                temp['Time'] = nowTime;
                                var json = JSON.stringify(temp);
                                callback(null, json);
                            })
                        }, function (err, results) {
                            var data = '{"CityCode" : '+cityID+', "Detail": '+results+'}';
                            res.send(data);
                            client.set(cityID+'_24h', data);
                        })
                    }
                })
            })
        }
    });
});

function isObjectEmpty(obj) {
    for (var i in obj) {
        return false;
    }
    return true;
}

module.exports = router;