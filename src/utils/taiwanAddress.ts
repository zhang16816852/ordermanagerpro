// src/utils/taiwanAddress.ts
// 全台 22 縣市 368 鄉鎮市區郵遞區號（前 3 碼）＋地址解析工具。
// 供配送卡片（ShippingAddressFields）分段級聯、整串地址 regex 解析、
// 郵區自動帶出使用。資料結構：縣市 → 鄉鎮市區 → 郵區（同名鄉鎮不同郵區，如「東區」）。

export interface TaiwanAddressParts {
  recipient: string
  phone: string
  postal_code: string
  city: string
  district: string
  address: string
}

// 縣市 → 鄉鎮市區 → 郵區（3 碼字串）
const POSTAL: Record<string, Record<string, string>> = {
  台北市: {
    中正區: '100', 大同區: '103', 中山區: '104', 松山區: '105', 大安區: '106',
    萬華區: '108', 信義區: '110', 士林區: '111', 北投區: '112', 內湖區: '114',
    南港區: '115', 文山區: '116',
  },
  基隆市: {
    仁愛區: '200', 信義區: '201', 中正區: '202', 中山區: '203', 安樂區: '204',
    暖暖區: '205', 七堵區: '206',
  },
  新北市: {
    萬里區: '207', 金山區: '208',
    板橋區: '220', 汐止區: '221', 深坑區: '222', 石碇區: '223', 瑞芳區: '224',
    平溪區: '226', 雙溪區: '227', 貢寮區: '228', 新店區: '231', 坪林區: '232',
    烏來區: '233', 永和區: '234', 中和區: '235', 土城區: '236', 三峽區: '237',
    樹林區: '238', 鶯歌區: '239', 三重區: '241', 新莊區: '242', 泰山區: '243',
    林口區: '244', 蘆洲區: '247', 五股區: '248', 八里區: '249', 淡水區: '251',
    三芝區: '252', 石門區: '253',
  },
  連江縣: { 南竿鄉: '209', 北竿鄉: '210', 莒光鄉: '211', 東引鄉: '212' },
  宜蘭縣: {
    宜蘭市: '260', 頭城鎮: '261', 礁溪鄉: '262', 壯圍鄉: '263', 員山鄉: '264',
    羅東鎮: '265', 三星鄉: '266', 大同鄉: '267', 五結鄉: '268', 冬山鄉: '269',
    蘇澳鎮: '270', 南澳鄉: '272',
  },
  新竹市: { 東區: '300', 北區: '300', 香山區: '300' },
  新竹縣: {
    竹北市: '302', 湖口鄉: '303', 新豐鄉: '304', 新埔鎮: '305', 關西鎮: '306',
    芎林鄉: '307', 寶山鄉: '308', 竹東鎮: '310', 五峰鄉: '311', 橫山鄉: '312',
    尖石鄉: '313', 北埔鄉: '314', 峨眉鄉: '315',
  },
  桃園市: {
    中壢區: '320', 平鎮區: '324', 龍潭區: '325', 楊梅區: '326', 新屋區: '327',
    觀音區: '328', 桃園區: '330', 龜山區: '333', 八德區: '334', 大溪區: '335',
    復興區: '336', 大園區: '337', 蘆竹區: '338',
  },
  苗栗縣: {
    竹南鎮: '350', 頭份市: '351', 三灣鄉: '352', 南庄鄉: '353', 獅潭鄉: '354',
    後龍鎮: '356', 通霄鎮: '357', 苑裡鎮: '358', 苗栗市: '360', 造橋鄉: '361',
    頭屋鄉: '362', 公館鄉: '363', 大湖鄉: '364', 泰安鄉: '365', 銅鑼鄉: '366',
    三義鄉: '367', 西湖鄉: '368', 卓蘭鎮: '369',
  },
  台中市: {
    中區: '400', 東區: '401', 南區: '402', 西區: '403', 北區: '404',
    北屯區: '406', 西屯區: '407', 南屯區: '408', 太平區: '411', 大里區: '412',
    霧峰區: '413', 烏日區: '414', 豐原區: '420', 后里區: '421', 石岡區: '422',
    東勢區: '423', 和平區: '424', 新社區: '426', 潭子區: '427', 大雅區: '428',
    神岡區: '429', 大肚區: '432', 沙鹿區: '433', 龍井區: '434', 梧棲區: '435',
    清水區: '436', 大甲區: '437', 外埔區: '438', 大安區: '439',
  },
  彰化縣: {
    彰化市: '500', 芬園鄉: '502', 花壇鄉: '503', 秀水鄉: '504', 鹿港鎮: '505',
    福興鄉: '506', 線西鄉: '507', 和美鎮: '508', 伸港鄉: '509', 員林市: '510',
    社頭鄉: '511', 永靖鄉: '512', 埔心鄉: '513', 溪湖鎮: '514', 大村鄉: '515',
    埔鹽鄉: '516', 田中鎮: '520', 北斗鎮: '521', 田尾鄉: '522', 埤頭鄉: '523',
    溪州鄉: '524', 竹塘鄉: '525', 二林鎮: '526', 大城鄉: '527', 芳苑鄉: '528',
    二水鄉: '530',
  },
  南投縣: {
    南投市: '540', 中寮鄉: '541', 草屯鎮: '542', 國姓鄉: '544', 埔里鎮: '545',
    仁愛鄉: '546', 名間鄉: '551', 集集鎮: '552', 水里鄉: '553', 魚池鄉: '555',
    信義鄉: '556', 竹山鎮: '557', 鹿谷鄉: '558',
  },
  雲林縣: {
    斗南鎮: '630', 大埤鄉: '631', 虎尾鎮: '632', 土庫鎮: '633', 褒忠鄉: '634',
    東勢鄉: '635', 台西鄉: '636', 崙背鄉: '637', 麥寮鄉: '638', 斗六市: '640',
    林內鄉: '643', 古坑鄉: '646', 莿桐鄉: '647', 西螺鎮: '648', 二崙鄉: '649',
    北港鎮: '651', 水林鄉: '652', 口湖鄉: '653', 四湖鄉: '654', 元長鄉: '655',
  },
  嘉義市: { 東區: '600', 西區: '600' },
  嘉義縣: {
    番路鄉: '602', 梅山鄉: '603', 竹崎鄉: '604', 阿里山鄉: '605', 中埔鄉: '606',
    大埔鄉: '607', 水上鄉: '608', 鹿草鄉: '611', 太保市: '612', 朴子市: '613',
    東石鄉: '614', 六腳鄉: '615', 新港鄉: '616', 民雄鄉: '621', 大林鎮: '622',
    溪口鄉: '623', 義竹鄉: '624', 布袋鎮: '625',
  },
  台南市: {
    中西區: '700', 東區: '701', 南區: '702', 北區: '704', 安平區: '708',
    安南區: '709', 永康區: '710', 歸仁區: '711', 新化區: '712', 左鎮區: '713',
    玉井區: '714', 楠西區: '715', 南化區: '716', 仁德區: '717', 關廟區: '718',
    龍崎區: '719', 官田區: '720', 麻豆區: '721', 佳里區: '722', 西港區: '723',
    七股區: '724', 將軍區: '725', 學甲區: '726', 北門區: '727', 新營區: '730',
    後壁區: '731', 白河區: '732', 東山區: '733', 六甲區: '734', 下營區: '735',
    柳營區: '736', 鹽水區: '737', 善化區: '741', 大內區: '742', 山上區: '743',
    新市區: '744', 安定區: '745',
  },
  高雄市: {
    新興區: '800', 前金區: '801', 苓雅區: '802', 鹽埕區: '803', 鼓山區: '804',
    旗津區: '805', 前鎮區: '806', 三民區: '807', 楠梓區: '811', 小港區: '812',
    左營區: '813', 仁武區: '814', 大社區: '815', 岡山區: '820', 路竹區: '821',
    阿蓮區: '822', 田寮區: '823', 燕巢區: '824', 橋頭區: '825', 梓官區: '826',
    彌陀區: '827', 永安區: '828', 湖內區: '829', 鳳山區: '830', 大寮區: '831',
    林園區: '832', 鳥松區: '833', 大樹區: '840', 旗山區: '842', 美濃區: '843',
    六龜區: '844', 內門區: '845', 杉林區: '846', 甲仙區: '847', 桃源區: '848',
    那瑪夏區: '849', 茂林區: '851', 茄萣區: '852',
  },
  屏東縣: {
    屏東市: '900', 三地門鄉: '901', 霧台鄉: '902', 瑪家鄉: '903', 九如鄉: '904',
    里港鄉: '905', 高樹鄉: '906', 鹽埔鄉: '907', 長治鄉: '908', 麟洛鄉: '909',
    竹田鄉: '911', 內埔鄉: '912', 萬丹鄉: '913', 潮州鎮: '920', 泰武鄉: '921',
    來義鄉: '922', 萬巒鄉: '923', 崁頂鄉: '924', 新埤鄉: '925', 南州鄉: '926',
    林邊鄉: '927', 東港鎮: '928', 琉球鄉: '929', 佳冬鄉: '931', 新園鄉: '932',
    枋寮鄉: '940', 枋山鄉: '941', 春日鄉: '942', 獅子鄉: '943', 車城鄉: '944',
    牡丹鄉: '945', 恆春鎮: '946', 滿州鄉: '947',
  },
  台東縣: {
    台東市: '950', 綠島鄉: '951', 蘭嶼鄉: '952', 延平鄉: '953', 卑南鄉: '954',
    鹿野鄉: '955', 關山鎮: '956', 海端鄉: '957', 池上鄉: '958', 東河鄉: '959',
    成功鎮: '961', 長濱鄉: '962', 太麻里鄉: '963', 金峰鄉: '964', 大武鄉: '965',
    達仁鄉: '966',
  },
  花蓮縣: {
    花蓮市: '970', 新城鄉: '971', 秀林鄉: '972', 吉安鄉: '973', 壽豐鄉: '974',
    鳳林鎮: '975', 光復鄉: '976', 豐濱鄉: '977', 瑞穗鄉: '978', 萬榮鄉: '979',
    玉里鎮: '981', 卓溪鄉: '982', 富里鄉: '983',
  },
  金門縣: {
    金沙鎮: '890', 金湖鎮: '891', 金寧鄉: '892', 金城鎮: '893', 烈嶼鄉: '894',
    烏坵鄉: '896',
  },
  澎湖縣: {
    馬公市: '880', 西嶼鄉: '881', 望安鄉: '882', 七美鄉: '883', 白沙鄉: '884',
    湖西鄉: '885',
  },
}

export const TAIWAN_CITIES = Object.keys(POSTAL) as readonly string[]

// 縣市別名（省「市/縣」尾字時也能解析）
const CITY_ALIASES: Record<string, string> = {
  台北: '台北市', 臺北: '台北市', 基隆: '基隆市', 新北: '新北市',
  宜蘭: '宜蘭縣', 花蓮: '花蓮縣', 台東: '台東縣', 臺東: '台東縣',
  桃園: '桃園市', 新竹縣: '新竹縣', 新竹: '新竹縣', 苗栗: '苗栗縣',
  彰化: '彰化縣', 南投: '南投縣', 雲林: '雲林縣', 嘉義縣: '嘉義縣',
  嘉義: '嘉義市', 屏東: '屏東縣', 台南: '台南市', 臺南: '台南市',
  台中: '台中市', 臺中: '台中市', 高雄: '高雄市', 連江: '連江縣',
  金門: '金門縣', 澎湖: '澎湖縣',
}
// 注意新竹市/嘉義市需在「新竹」「嘉義」alias 之前精確比對。

const DISTRICT_ALIASES: Record<string, string> = {
  台西: '台西鄉', 霧台: '霧台鄉', 臺西: '台西鄉', 臺東市: '台東市',
}

export function isTaiwanCity(value: string): value is string {
  return value in POSTAL
}

const ALL_DISTRICTS: string[] = Object.values(POSTAL)
  .map((d) => Object.keys(d))
  .flat()
  .sort((a, b) => b.length - a.length)

export function getTaiwanCities(): string[] {
  return [...TAIWAN_CITIES]
}

export function getDistrictsOfCity(city: string): string[] {
  const key = CITY_ALIASES[city] || (city in POSTAL ? city : '')
  return key ? Object.keys(POSTAL[key]) : []
}

export function getPostalOf(city: string, district: string): string | null {
  const cityKey = CITY_ALIASES[city] || (city in POSTAL ? city : '')
  if (!cityKey) return null
  const districtKey = DISTRICT_ALIASES[district] || district
  return POSTAL[cityKey][districtKey] ?? null
}

export function cityFromFullText(text: string): string | null {
  if (!text) return null
  for (const city of TAIWAN_CITIES) {
    if (text.includes(city)) return city
  }
  // 再比對別名（先處理有尾字的新竹市/嘉義市，再處理無尾字）
  if (text.includes('新竹市')) return '新竹市'
  if (text.includes('嘉義市')) return '嘉義市'
  const aliasEntries = Object.entries(CITY_ALIASES)
    .filter(([k]) => k !== '新竹市' && k !== '嘉義市')
    .sort((a, b) => b[0].length - a[0].length)
  for (const [alias, key] of aliasEntries) {
    if (text.includes(alias)) return key
  }
  return null
}

export function districtFromFullText(text: string): string | null {
  if (!text) return null
  for (const [alias, canonical] of Object.entries(DISTRICT_ALIASES)) {
    if (text.includes(alias)) return canonical
  }
  for (const district of ALL_DISTRICTS) {
    if (text.includes(district)) return district
  }
  return null
}

export function postalFromFullText(text: string): string | null {
  if (!text) return null
  // 標籤式：郵遞區號：XXX 或 郵簡 XXX
  const labeled = text.match(/(?:郵遞區號|郵區|郵簡|ZIP|POSTAL)\s*[：:]?\s*(\d{3})(?:-?\d{2})?/i)
  if (labeled) return labeled[1]
  // 3 碼或 5 碼（-xxx 分隔）出現在字首
  const lead = text.match(/^\s*(\d{3})(?:(?:-|)\d{2})?/)
  if (lead) return lead[1]
  return null
}

// 整串地址 → 分段（供表單預填）
export function parseTaiwanAddressText(text: string): Partial<TaiwanAddressParts> {
  if (!text) return {}
  const cleaned = text.trim()
  let city = cityFromFullText(cleaned) || ''
  let district = districtFromFullText(cleaned) || ''
  const postal_code = postalFromFullText(cleaned) || ''

  // 若給定 postal 但無 city/district，嘗試反查
  if (postal_code && (!city || !district)) {
    for (const [c, districts] of Object.entries(POSTAL)) {
      for (const [d, p] of Object.entries(districts)) {
        if (p === postal_code) {
          if (!city) city = c
          if (!district) district = d
          break
        }
      }
    }
  }

  let address = cleaned
  if (city) address = address.replace(city, '')
  if (district) address = address.replace(district, '')
  address = address
    .replace(/(?:郵遞區號|郵區|郵簡|ZIP|POSTAL)\s*[：:]?[\d]{3}(?:-?\d{2})?/gi, '')
    .replace(/^\s*\d{3}(?:(?:-|)\d{2})?/, '')
    .replace(/^[\s,，、:：\u3000]+|[\s,，、:：\u3000]+$/g, '')
    .trim()

  return {
    postal_code: postal_code || undefined,
    city: city || undefined,
    district: district || undefined,
    address: address || undefined,
  }
}

export function formatAddress(parts: Partial<TaiwanAddressParts>): string {
  const { city, district, address, postal_code } = parts
  const body = `${city || ''}${district || ''}${address || ''}`
  if (!body) return ''
  return postal_code ? `${postal_code} ${body}` : body
}

export function emptyAddress(): TaiwanAddressParts {
  return { recipient: '', phone: '', postal_code: '', city: '', district: '', address: '' }
}