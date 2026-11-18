import type { Unit } from '@dukaan/core';

export type Category = {
  name: string;
  hsn: string;
  gstBp: number;
  unit: Unit;
  products: readonly (readonly [english: string, hindi: string])[];
  sizes: readonly (readonly [label: string, baseMilli: number])[];
  /** ₹ per base size, min–max */
  price: readonly [number, number];
  loose?: boolean;
  pharmacy?: boolean;
};

// GST 2.0 slabs (effective 22 Sep 2025): most staples 0/5 %, most FMCG 18 %, sin goods 40 %.
export const CATEGORIES: readonly Category[] = [
  { name: 'Rice', hsn: '1006', gstBp: 500, unit: 'kg', price: [45, 180], loose: true,
    products: [['Basmati Rice', 'बासमती चावल'], ['Sona Masoori Rice', 'सोना मसूरी चावल'], ['Kolam Rice', 'कोलम चावल'], ['Brown Rice', 'ब्राउन चावल'], ['Idli Rice', 'इडली चावल'], ['Ponni Rice', 'पोन्नी चावल'], ['Jeera Rice', 'जीरा चावल']],
    sizes: [['1kg', 1000], ['5kg', 5000], ['10kg', 10000], ['25kg', 25000]] },
  { name: 'Atta & Flours', hsn: '1101', gstBp: 500, unit: 'kg', price: [38, 90], loose: true,
    products: [['Whole Wheat Atta', 'गेहूं आटा'], ['Chakki Atta', 'चक्की आटा'], ['Maida', 'मैदा'], ['Besan', 'बेसन'], ['Suji Rava', 'सूजी'], ['Ragi Flour', 'रागी आटा'], ['Bajra Flour', 'बाजरा आटा'], ['Jowar Flour', 'ज्वार आटा'], ['Rice Flour', 'चावल आटा']],
    sizes: [['500g', 500], ['1kg', 1000], ['5kg', 5000], ['10kg', 10000]] },
  { name: 'Dal & Pulses', hsn: '0713', gstBp: 500, unit: 'kg', price: [90, 190], loose: true,
    products: [['Toor Dal', 'तूर दाल'], ['Moong Dal', 'मूंग दाल'], ['Chana Dal', 'चना दाल'], ['Masoor Dal', 'मसूर दाल'], ['Urad Dal', 'उड़द दाल'], ['Rajma', 'राजमा'], ['Kabuli Chana', 'काबुली चना'], ['Kala Chana', 'काला चना'], ['Moong Whole', 'साबुत मूंग']],
    sizes: [['500g', 500], ['1kg', 1000], ['2kg', 2000], ['5kg', 5000]] },
  { name: 'Edible Oil', hsn: '1512', gstBp: 500, unit: 'l', price: [120, 260],
    products: [['Sunflower Oil', 'सूरजमुखी तेल'], ['Mustard Oil', 'सरसों तेल'], ['Groundnut Oil', 'मूंगफली तेल'], ['Rice Bran Oil', 'राइस ब्रान तेल'], ['Soyabean Oil', 'सोयाबीन तेल'], ['Coconut Oil', 'नारियल तेल'], ['Sesame Oil', 'तिल तेल']],
    sizes: [['500ml', 500], ['1L', 1000], ['2L', 2000], ['5L', 5000], ['15L', 15000]] },
  { name: 'Ghee & Butter', hsn: '0405', gstBp: 500, unit: 'pcs', price: [55, 750],
    products: [['Cow Ghee', 'गाय का घी'], ['Desi Ghee', 'देसी घी'], ['Buffalo Ghee', 'भैंस का घी'], ['Salted Butter', 'मक्खन'], ['White Butter', 'सफ़ेद मक्खन']],
    sizes: [['100g', 1000], ['200g', 1000], ['500ml', 1000], ['1L', 1000]] },
  { name: 'Sugar, Salt & Jaggery', hsn: '1701', gstBp: 500, unit: 'kg', price: [20, 90], loose: true,
    products: [['Sugar', 'चीनी'], ['Iodised Salt', 'नमक'], ['Rock Salt', 'सेंधा नमक'], ['Black Salt', 'काला नमक'], ['Jaggery', 'गुड़'], ['Brown Sugar', 'ब्राउन चीनी'], ['Mishri', 'मिश्री']],
    sizes: [['500g', 500], ['1kg', 1000], ['5kg', 5000]] },
  { name: 'Masala & Spices', hsn: '0910', gstBp: 500, unit: 'pcs', price: [10, 160],
    products: [['Turmeric Powder', 'हल्दी पाउडर'], ['Red Chilli Powder', 'लाल मिर्च पाउडर'], ['Coriander Powder', 'धनिया पाउडर'], ['Jeera', 'जीरा'], ['Garam Masala', 'गरम मसाला'], ['Chaat Masala', 'चाट मसाला'], ['Kitchen King Masala', 'किचन किंग मसाला'], ['Hing', 'हींग'], ['Black Pepper', 'काली मिर्च'], ['Elaichi', 'इलायची'], ['Laung', 'लौंग'], ['Dalchini', 'दालचीनी'], ['Rai', 'राई'], ['Methi Seeds', 'मेथी दाना'], ['Ajwain', 'अजवाइन'], ['Kasuri Methi', 'कसूरी मेथी'], ['Pav Bhaji Masala', 'पाव भाजी मसाला'], ['Sambar Masala', 'सांबर मसाला'], ['Chole Masala', 'छोले मसाला'], ['Biryani Masala', 'बिरयानी मसाला']],
    sizes: [['50g', 1000], ['100g', 1000], ['200g', 1000], ['500g', 1000]] },
  { name: 'Tea & Coffee', hsn: '0902', gstBp: 500, unit: 'pcs', price: [10, 550],
    products: [['Tea Leaves', 'चाय पत्ती'], ['Green Tea', 'ग्रीन टी'], ['Masala Chai', 'मसाला चाय'], ['Instant Coffee', 'कॉफ़ी'], ['Filter Coffee', 'फ़िल्टर कॉफ़ी'], ['Dust Tea', 'चाय'], ['Elaichi Tea', 'इलायची चाय']],
    sizes: [['100g', 1000], ['250g', 1000], ['500g', 1000], ['1kg', 1000], ['25 bags', 1000]] },
  { name: 'Biscuits & Snacks', hsn: '1905', gstBp: 500, unit: 'pcs', price: [5, 120],
    products: [['Glucose Biscuit', 'ग्लूकोज़ बिस्कुट'], ['Cream Biscuit', 'क्रीम बिस्कुट'], ['Marie Biscuit', 'मैरी बिस्कुट'], ['Cookies', 'कुकीज़'], ['Rusk', 'रस्क'], ['Namkeen Bhujia', 'भुजिया'], ['Aloo Bhujia', 'आलू भुजिया'], ['Chips', 'चिप्स'], ['Mixture', 'मिक्सचर'], ['Khakhra', 'खाखरा'], ['Salted Peanuts', 'नमकीन मूंगफली'], ['Moong Dal Namkeen', 'मूंग दाल नमकीन']],
    sizes: [['50g', 1000], ['100g', 1000], ['200g', 1000], ['400g', 1000], ['1kg', 1000]] },
  { name: 'Instant Food', hsn: '1902', gstBp: 500, unit: 'pcs', price: [12, 140],
    products: [['Instant Noodles', 'नूडल्स'], ['Pasta', 'पास्ता'], ['Vermicelli', 'सेवई'], ['Poha', 'पोहा'], ['Oats', 'ओट्स'], ['Cornflakes', 'कॉर्नफ्लेक्स'], ['Upma Mix', 'उपमा मिक्स'], ['Gulab Jamun Mix', 'गुलाब जामुन मिक्स'], ['Soup', 'सूप'], ['Ready Paneer Masala', 'पनीर मसाला']],
    sizes: [['70g', 1000], ['140g', 1000], ['280g', 1000], ['500g', 1000], ['1kg', 1000]] },
  { name: 'Dairy', hsn: '0401', gstBp: 0, unit: 'pcs', price: [25, 120],
    products: [['Toned Milk', 'दूध'], ['Full Cream Milk', 'फुल क्रीम दूध'], ['Curd', 'दही'], ['Paneer', 'पनीर'], ['Buttermilk', 'छाछ'], ['Lassi', 'लस्सी']],
    sizes: [['200ml', 1000], ['500ml', 1000], ['1L', 1000], ['200g', 1000], ['400g', 1000]] },
  { name: 'Soaps & Body', hsn: '3401', gstBp: 500, unit: 'pcs', price: [20, 260],
    products: [['Bath Soap', 'साबुन'], ['Neem Soap', 'नीम साबुन'], ['Sandal Soap', 'चंदन साबुन'], ['Body Wash', 'बॉडी वॉश'], ['Hand Wash', 'हैंड वॉश'], ['Shampoo', 'शैम्पू'], ['Hair Oil', 'बालों का तेल'], ['Coconut Hair Oil', 'नारियल बालों का तेल'], ['Talcum Powder', 'पाउडर'], ['Face Cream', 'फ़ेस क्रीम']],
    sizes: [['75g', 1000], ['100g', 1000], ['4x100g', 1000], ['180ml', 1000], ['340ml', 1000], ['650ml', 1000]] },
  { name: 'Oral Care', hsn: '3306', gstBp: 500, unit: 'pcs', price: [15, 220],
    products: [['Toothpaste', 'टूथपेस्ट'], ['Herbal Toothpaste', 'हर्बल टूथपेस्ट'], ['Toothbrush', 'टूथब्रश'], ['Mouthwash', 'माउथवॉश'], ['Tooth Powder', 'दंत मंजन']],
    sizes: [['50g', 1000], ['100g', 1000], ['150g', 1000], ['200g', 1000], ['Pack of 4', 1000]] },
  { name: 'Detergent & Cleaning', hsn: '3402', gstBp: 1800, unit: 'pcs', price: [10, 650],
    products: [['Detergent Powder', 'वाशिंग पाउडर'], ['Detergent Bar', 'कपड़े धोने का साबुन'], ['Liquid Detergent', 'लिक्विड डिटर्जेंट'], ['Dishwash Bar', 'बर्तन साबुन'], ['Dishwash Liquid', 'बर्तन धोने का लिक्विड'], ['Floor Cleaner', 'फ़र्श क्लीनर'], ['Toilet Cleaner', 'टॉयलेट क्लीनर'], ['Glass Cleaner', 'ग्लास क्लीनर'], ['Phenyl', 'फिनाइल'], ['Scrub Pad', 'स्क्रब']],
    sizes: [['500g', 1000], ['1kg', 1000], ['2kg', 1000], ['500ml', 1000], ['1L', 1000], ['Pack of 3', 1000]] },
  { name: 'Beverages', hsn: '2202', gstBp: 1800, unit: 'pcs', price: [10, 120],
    products: [['Cola', 'कोला'], ['Lemon Soda', 'नींबू सोडा'], ['Mango Drink', 'आम का जूस'], ['Orange Juice', 'संतरे का जूस'], ['Energy Drink', 'एनर्जी ड्रिंक'], ['Packaged Water', 'पानी की बोतल'], ['Jeera Soda', 'जीरा सोडा'], ['Rose Sharbat', 'रूह अफ़ज़ा शरबत']],
    sizes: [['250ml', 1000], ['600ml', 1000], ['1L', 1000], ['1.25L', 1000], ['2L', 1000]] },
  { name: 'Chocolates & Sweets', hsn: '1806', gstBp: 500, unit: 'pcs', price: [5, 400],
    products: [['Milk Chocolate', 'चॉकलेट'], ['Dark Chocolate', 'डार्क चॉकलेट'], ['Wafer Bar', 'वेफ़र'], ['Toffee', 'टॉफ़ी'], ['Soan Papdi', 'सोन पापड़ी'], ['Kaju Katli', 'काजू कतली'], ['Rasgulla Tin', 'रसगुल्ला']],
    sizes: [['10g', 1000], ['40g', 1000], ['100g', 1000], ['250g', 1000], ['500g', 1000], ['1kg', 1000]] },
  { name: 'Dry Fruits', hsn: '0801', gstBp: 500, unit: 'kg', price: [400, 1600], loose: true,
    products: [['Cashew', 'काजू'], ['Almond', 'बादाम'], ['Raisins', 'किशमिश'], ['Pista', 'पिस्ता'], ['Walnut', 'अखरोट'], ['Dates', 'खजूर'], ['Makhana', 'मखाना'], ['Dry Coconut', 'खोपरा']],
    sizes: [['100g', 100], ['250g', 250], ['500g', 500], ['1kg', 1000]] },
  { name: 'Pooja & Home', hsn: '3307', gstBp: 500, unit: 'pcs', price: [10, 250],
    products: [['Agarbatti', 'अगरबत्ती'], ['Dhoop', 'धूप'], ['Camphor', 'कपूर'], ['Diya Cotton Wicks', 'रुई बत्ती'], ['Matchbox', 'माचिस'], ['Candles', 'मोमबत्ती'], ['Mosquito Coil', 'मच्छर कॉइल'], ['Mosquito Liquid', 'मच्छर लिक्विड']],
    sizes: [['Small', 1000], ['Medium', 1000], ['Large', 1000], ['Pack of 10', 1000], ['Pack of 2', 1000]] },
  { name: 'Tobacco & Pan', hsn: '2403', gstBp: 4000, unit: 'pcs', price: [5, 350],
    products: [['Pan Masala', 'पान मसाला'], ['Chewing Tobacco', 'तंबाकू'], ['Gutka', 'गुटखा'], ['Supari', 'सुपारी'], ['Cigarettes', 'सिगरेट']],
    sizes: [['Sachet', 1000], ['Pouch', 1000], ['Pack of 10', 1000], ['Pack of 20', 1000], ['Tin', 1000]] },
  { name: 'Medicines (OTC)', hsn: '3004', gstBp: 500, unit: 'pcs', price: [10, 450], pharmacy: true,
    products: [['Paracetamol 500mg', 'पैरासिटामोल'], ['Paracetamol 650mg', 'पैरासिटामोल 650'], ['Cetirizine 10mg', 'सेट्रिज़िन'], ['Antacid Gel', 'एंटासिड'], ['ORS Powder', 'ओआरएस'], ['Cough Syrup', 'खांसी सिरप'], ['Vitamin C Tablets', 'विटामिन सी'], ['Pain Relief Balm', 'दर्द बाम'], ['Antiseptic Liquid', 'एंटीसेप्टिक'], ['Bandage Roll', 'पट्टी'], ['Digestive Churan', 'चूरन'], ['Ibuprofen 400mg', 'आइबुप्रोफ़ेन']],
    sizes: [['Strip of 10', 1000], ['Strip of 15', 1000], ['100ml', 1000], ['Pack of 5', 1000], ['50g', 1000]] },
  { name: 'Stationery', hsn: '4820', gstBp: 1800, unit: 'pcs', price: [5, 180],
    products: [['Notebook', 'कॉपी'], ['Ball Pen', 'पेन'], ['Gel Pen', 'जेल पेन'], ['Pencil', 'पेंसिल'], ['Eraser', 'रबर'], ['Glue Stick', 'गोंद'], ['Geometry Box', 'ज्योमेट्री बॉक्स'], ['Register', 'रजिस्टर']],
    sizes: [['Single', 1000], ['Pack of 5', 1000], ['Pack of 10', 1000], ['200 pages', 1000]] },
  { name: 'Hardware', hsn: '7318', gstBp: 1800, unit: 'pcs', price: [2, 900],
    products: [['Wood Screw', 'स्क्रू'], ['Nails', 'कील'], ['PVC Pipe Elbow', 'पाइप एल्बो'], ['Electrical Tape', 'टेप'], ['LED Bulb 9W', 'एलईडी बल्ब'], ['Switch Board', 'स्विच बोर्ड'], ['Extension Cord', 'एक्सटेंशन'], ['Padlock', 'ताला'], ['Paint Brush', 'पेंट ब्रश'], ['Fevicol', 'फ़ेविकोल']],
    sizes: [['Single', 1000], ['Pack of 10', 1000], ['Pack of 50', 1000], ['Small', 1000], ['Large', 1000]] },
];

export const BRANDS: readonly string[] = [
  'Aashirvaad', 'Fortune', 'Tata', 'Patanjali', 'Daawat', 'India Gate', 'Kohinoor', 'Rajdhani', 'Pillsbury', 'Annapurna',
  'Saffola', 'Dhara', 'Gemini', 'Gold Drop', 'Amul', 'Mother Dairy', 'Nandini', 'Aavin', 'Gowardhan', 'Britannia', 'Parle',
  'Sunfeast', 'Haldiram', 'Bikaji', 'Balaji', 'Lays', 'Kurkure', 'Maggi', 'Yippee', 'Top Ramen', 'MTR', 'Everest', 'MDH',
  'Catch', 'Aachi', 'Sakthi', 'Badshah', 'Eastern', 'Red Label', 'Taj Mahal', 'Wagh Bakri', 'Society', 'Bru', 'Nescafe',
  'Lux', 'Lifebuoy', 'Santoor', 'Dettol', 'Mysore Sandal', 'Medimix', 'Cinthol', 'Pears', 'Clinic Plus', 'Parachute',
  'Colgate', 'Pepsodent', 'Dabur', 'Close Up', 'Vicco', 'Surf Excel', 'Ariel', 'Tide', 'Rin', 'Wheel', 'Ghadi', 'Nirma',
  'Vim', 'Pril', 'Exo', 'Lizol', 'Harpic', 'Colin', 'Thums Up', 'Sprite', 'Maaza', 'Frooti', 'Real', 'Paper Boat', 'Bisleri',
  'Kinley', 'Cadbury', 'Nestle', 'Amul Choco', 'Happilo', 'Nutraj', 'Cycle', 'Mangaldeep', 'Zed Black', 'Good Knight',
  'All Out', 'Mortein', 'Vicks', 'Cipla', 'Dr. Reddys', 'Himalaya', 'Zandu', 'Hajmola', 'Classmate', 'Reynolds', 'Natraj',
  'Apsara', 'Fevicol', 'Anchor', 'Havells', 'Philips', 'Godrej', 'Asian Paints', 'Local', 'Shop Brand', 'Organic India',
  '24 Mantra', 'Pro Nature', 'Tata Sampann', 'Kissan', 'Del Monte', 'Mapro', 'Ching\'s', 'Knorr', 'Kellogg\'s', 'Quaker',
];

export const VARIANTS: readonly string[] = [
  '', 'Premium', 'Gold', 'Classic', 'Lite', 'Extra', 'Super', 'Select', 'Value Pack', 'Family Pack', 'Combo', 'Special', 'Pure', 'Fresh', 'Natural',
];

export const FIRST_NAMES = ['Ramesh', 'Suresh', 'Sunita', 'Anita', 'Rajesh', 'Priya', 'Mohammed', 'Fatima', 'Lakshmi', 'Venkatesh', 'Ganesh', 'Kavita', 'Deepak', 'Pooja', 'Arjun', 'Meena', 'Vijay', 'Rekha', 'Imran', 'Sneha', 'Harpreet', 'Gurpreet', 'Anil', 'Sangeeta', 'Ravi', 'Geeta', 'Manoj', 'Shabana', 'Kiran', 'Prakash'];
export const LAST_NAMES = ['Sharma', 'Verma', 'Patil', 'Deshmukh', 'Iyer', 'Nair', 'Reddy', 'Khan', 'Shaikh', 'Gupta', 'Agarwal', 'Joshi', 'Kulkarni', 'Singh', 'Yadav', 'Pillai', 'Das', 'Mehta', 'Jain', 'Pawar'];
