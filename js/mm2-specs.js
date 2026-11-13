/**
 * MicroMonsta 2 (MM2) Specification and Parameter Definitions
 * Supports Firmware v3.x (216 bytes) and Firmware v2.x (176 bytes)
 */

const SYSEX_HEADER = [0xF0, 0x00, 0x21, 0x22, 0x4D, 0x02];
const SYSEX_START = 0xF0;
const SYSEX_END = 0xF7;
const SYSEX_V3_LEN = 216;
const SYSEX_V2_LEN = 176;
const SYSEX_V3_FW_ID = 0x30; // '0' = 48 decimal
const SYSEX_V2_FW_ID = 0x10; // 16 decimal (v2.7+ SysEx template)

const CMD_LOAD_A = 0x01;
const CMD_LOAD_B = 0x02;
const CMD_LOAD_ACTIVE = 0x03;

// Hardware Fetch Request Commands (Firmware SysEx query)
const SYSEX_FETCH_A = [0xF0, 0x00, 0x21, 0x22, 0x4D, 0x02, 0x41, 0xF7]; // 'A' = 0x41
const SYSEX_FETCH_B = [0xF0, 0x00, 0x21, 0x22, 0x4D, 0x02, 0x42, 0xF7]; // 'B' = 0x42

const OFFSET_CMD = 6;
const OFFSET_FW = 7;
const OFFSET_NAME = 8;
const OFFSET_CAT = 16;

const {
    LOOKUPS,
    INIT_PROGRAM_BYTES,
    MM2_PARAMETERS,
    V2_V3_MAP,
    V3_NEW_PARAMS
} = (() => {
const zs=[["LAY_NAME_1",8,8,1,"copy"],["LAY_NAME_2",9,9,1,"copy"],["LAY_NAME_3",10,10,1,"copy"],["LAY_NAME_4",11,11,1,"copy"],["LAY_NAME_5",12,12,1,"copy"],["LAY_NAME_6",13,13,1,"copy"],["LAY_NAME_7",14,14,1,"copy"],["LAY_NAME_8",15,15,1,"copy"],["LAY_CATEGORY",16,16,1,"copy"],["LAY_POT1_ASSIGN",17,17,1,"assign"],["LAY_POT2_ASSIGN",18,18,1,"assign"],["LAY_POT3_ASSIGN",19,19,1,"assign"],["LAY_ENC1_ASSIGN",20,20,1,"assign"],["LAY_ENC2_ASSIGN",21,21,1,"assign"],["LAY_ENC3_ASSIGN",22,22,1,"assign"],["LAY_ENC4_ASSIGN",23,23,1,"assign"],["LAY_MASTER_VOLUME",24,24,1,"copy"],["LAY_TEMPO",25,25,2,"copy"],["VCE_DETUNE",27,27,1,"copy"],["VCE_DETUNE_OSC",28,28,1,"copy"],["VCE_PAN_SPREAD",29,29,1,"copy"],["VCE_GLIDE",30,30,1,"copy"],["VCE_PBRANGE_DOWN",31,31,1,"copy"],["VCE_PBRANGE_UP",32,32,1,"copy"],["ENV1_VCA_VEL_SENS",33,33,1,"copy"],["ENV2_FLT_VEL_SENS",34,34,1,"copy"],["OSC1_ALGO",35,35,1,"copy"],["OSC1_SHAPE",36,36,1,"copy"],["OSC1_TUNE",37,37,1,"copy"],["OSC1_FINETUNE",38,38,1,"copy"],["OSC2_ALGO",39,39,1,"copy"],["OSC2_SHAPE",40,40,1,"copy"],["OSC2_TUNE",41,41,1,"copy"],["OSC2_FINETUNE",42,42,1,"copy"],["OSC3_ALGO",43,43,1,"copy"],["OSC3_SHAPE",44,44,1,"copy"],["OSC3_TUNE",45,45,1,"copy"],["OSC3_FINETUNE",46,46,1,"copy"],["MIX_OSC1",47,47,1,"copy"],["MIX_OSC2",48,48,1,"copy"],["MIX_OSC3",49,49,1,"copy"],["MIX_NOISE",50,50,1,"copy"],["FILTER_FREQ",51,51,2,"copy"],["FILTER_RESO",53,53,1,"copy"],["FILTER_ENV2",54,54,2,"copy"],["FILTER_TRACKING",56,56,1,"copy"],["FILTER_FM",57,57,1,"copy"],["DRIVE_VOICE",58,60,1,"copy"],["ENV1_ATK",59,61,1,"copy"],["ENV1_DCY",60,62,1,"copy"],["ENV1_SUS",61,63,1,"copy"],["ENV1_REL",62,64,1,"copy"],["ENV2_ATK",63,65,1,"copy"],["ENV2_DCY",64,66,1,"copy"],["ENV2_SUS",65,67,1,"copy"],["ENV2_REL",66,68,1,"copy"],["ENV3_ATK",67,69,1,"copy"],["ENV3_DCY",68,70,1,"copy"],["ENV3_SUS",69,71,1,"copy"],["ENV3_REL",70,72,1,"copy"],["LFO1_WAVE",71,73,1,"copy"],["LFO1_SPEED",72,75,2,"copy"],["LFO1_MODE",74,74,1,"copy"],["LFO2_WAVE",75,77,1,"copy"],["LFO2_SPEED",76,79,2,"copy"],["LFO2_MODE",78,78,1,"copy"],["LFO3_WAVE",79,81,1,"copy"],["LFO3_SPEED",80,83,2,"copy"],["LFO3_MODE",82,82,1,"copy"],["MTX1_SRC",83,85,1,"source"],["MTX1_DST",84,86,1,"destination"],["MTX1_AMT",85,109,2,"copy"],["MTX2_SRC",87,87,1,"source"],["MTX2_DST",88,88,1,"destination"],["MTX2_AMT",89,111,2,"copy"],["MTX3_SRC",91,89,1,"source"],["MTX3_DST",92,90,1,"destination"],["MTX3_AMT",93,113,2,"copy"],["MTX4_SRC",95,91,1,"source"],["MTX4_DST",96,92,1,"destination"],["MTX4_AMT",97,115,2,"copy"],["MTX5_SRC",99,93,1,"source"],["MTX5_DST",100,94,1,"destination"],["MTX5_AMT",101,117,2,"copy"],["MTX6_SRC",103,95,1,"source"],["MTX6_DST",104,96,1,"destination"],["MTX6_AMT",105,119,2,"copy"],["MTX7_SRC",107,97,1,"source"],["MTX7_DST",108,98,1,"destination"],["MTX7_AMT",109,121,2,"copy"],["MTX8_SRC",111,99,1,"source"],["MTX8_DST",112,100,1,"destination"],["MTX8_AMT",113,123,2,"copy"],["MTX9_SRC",115,101,1,"source"],["MTX9_DST",116,102,1,"destination"],["MTX9_AMT",117,125,2,"copy"],["MTX10_SRC",119,103,1,"source"],["MTX10_DST",120,104,1,"destination"],["MTX10_AMT",121,127,2,"copy"],["LAG_SRC1",123,137,1,"copy"],["LAG_AMT1",124,138,1,"copy"],["MULT_A1",125,133,1,"copy"],["MULT_B1",126,134,1,"copy"],["MULT_A2",127,135,1,"copy"],["MULT_B2",128,136,1,"copy"],["MORPH_KNOB",129,139,1,"copy"],["IFX_EQ",130,145,2,"copy"],["DLY_PARAM1",132,147,2,"copy"],["DLY_PARAM2",134,140,1,"copy"],["DLY_PARAM3",135,141,1,"copy"],["REV_PARAM1",136,142,1,"copy"],["REV_PARAM2",137,143,1,"copy"],["REV_PARAM3",138,144,1,"copy"],["ARP_TYPE",139,149,1,"copy"],["ARP_GATE",140,153,1,"copy"],["ARP_SPEED",141,150,1,"copy"],["VCE_MODE",142,154,1,"copy"],["VCE_UNISON",143,155,1,"copy"],["PAN_MODE",144,156,1,"copy"],["ENV1_RESET",145,157,1,"copy"],["ENV2_RESET",146,158,1,"copy"],["ENV3_RESET",147,159,1,"copy"],["PLACEHOLDER3",148,160,1,"zero"],["OSC_PHASE_RESET",149,161,1,"copy"],["FILTER_ALGO",150,162,1,"copy"],["FILTER_CHARACTER",151,163,1,"zero"],["IFX_CHORUS",152,164,1,"copy"],["DLY_TYPE",153,165,1,"copy"],["PLACEHOLDER4",154,166,1,"zero"],["ARP_OFF_ON",155,167,1,"copy"],["ARP_LATCH",156,168,1,"copy"],["ARP_OCTAVE",157,169,1,"copy"],["ARP_PTN_LENGTH",158,170,1,"copy"],["ARP_PTN_STEP01",159,171,1,"copy"],["ARP_PTN_STEP02",160,172,1,"copy"],["ARP_PTN_STEP03",161,173,1,"copy"],["ARP_PTN_STEP04",162,174,1,"copy"],["ARP_PTN_STEP05",163,175,1,"copy"],["ARP_PTN_STEP06",164,176,1,"copy"],["ARP_PTN_STEP07",165,177,1,"copy"],["ARP_PTN_STEP08",166,178,1,"copy"],["ARP_PTN_STEP09",167,179,1,"copy"],["ARP_PTN_STEP10",168,180,1,"copy"],["ARP_PTN_STEP11",169,181,1,"copy"],["ARP_PTN_STEP12",170,182,1,"copy"],["ARP_PTN_STEP13",171,183,1,"copy"],["ARP_PTN_STEP14",172,184,1,"copy"],["ARP_PTN_STEP15",173,185,1,"copy"],["ARP_PTN_STEP16",174,186,1,"copy"]],js=[["PLACEHOLDER1",58,1,0],["PLACEHOLDER2",59,1,0],["MTX11_SRC",105,1,0],["MTX11_DST",106,1,0],["MTX12_SRC",107,1,0],["MTX12_DST",108,1,0],["MTX11_AMT",129,2,128],["MTX12_AMT",131,2,128],["ARP_STEPSEQ_DEST",151,1,0],["ARP_STEPSEQ_POLARITY",152,1,1],["ARP_PTN_STEP_MOD01",187,1,1],["ARP_PTN_STEP_MOD02",188,1,1],["ARP_PTN_STEP_MOD03",189,1,1],["ARP_PTN_STEP_MOD04",190,1,1],["ARP_PTN_STEP_MOD05",191,1,1],["ARP_PTN_STEP_MOD06",192,1,1],["ARP_PTN_STEP_MOD07",193,1,1],["ARP_PTN_STEP_MOD08",194,1,1],["ARP_PTN_STEP_MOD09",195,1,1],["ARP_PTN_STEP_MOD10",196,1,1],["ARP_PTN_STEP_MOD11",197,1,1],["ARP_PTN_STEP_MOD12",198,1,1],["ARP_PTN_STEP_MOD13",199,1,1],["ARP_PTN_STEP_MOD14",200,1,1],["ARP_PTN_STEP_MOD15",201,1,1],["ARP_PTN_STEP_MOD16",202,1,1],["KBD_MIDI_INPUT",203,1,0],["KBD_KEY",204,1,0],["KBD_CHORD_EXPAND",205,1,0],["KBD_OCTAVE",206,1,64],["KBD_SCALE",207,1,0],["CHORD_TYPE1",208,1,0],["CHORD_TYPE2",209,1,0],["CHORD_TYPE3",210,1,0],["CHORD_TYPE4",211,1,0],["CHORD_TYPE5",212,1,0],["CHORD_TYPE6",213,1,0],["CHORD_TYPE7",214,1,0]];
const ue=new Uint8Array([240,0,33,34,77,2,3,48,73,78,73,84,32,32,32,32,13,0,0,0,0,0,0,0,67,0,80,24,24,24,0,62,2,0,0,6,0,64,64,6,0,64,59,10,0,52,64,127,0,0,0,1,127,0,1,0,0,0,0,0,0,0,0,127,0,42,64,32,32,42,64,32,32,0,3,0,64,0,0,0,48,0,0,0,48,21,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,8,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,0,0,0,0,0,0,0,48,0,42,42,0,1,0,0,84,0,7,0,1,64,0,0,0,0,0,0,0,0,3,0,0,3,0,0,0,0,15,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,64,0,0,0,0,0,0,0,0,247]),os=["Bass","Lead","Pad","Keys","Organ","Strings","Brass","Percussion","Drone","Noise","SFX","Arp","Misc","User1","User2","User3"],bt=Array.from({length:128},(e,t)=>t.toString()),F=["Off","On"],K=["SYSTEM","Mod Knob","Tempo","Volume","Pan","Glide","Shape 1","Tune 1","Shape 2","Tune 2","Shape 3","Tune 3","Mix 1","Mix 2","Mix 3","Noise","Cutoff","Resonance","Filter Env","Filter FM","Drive","Attack 1","Decay 1","Sustain 1","Release 1","Attack 2","Decay 2","Sustain 2","Release 2","Attack 3","Decay 3","Sustain 3","Release 3","LFO 1 Speed","LFO 2 Speed","LFO 3 Speed","Matrix 1","Matrix 2","Matrix 3","Matrix 4","Matrix 5","Matrix 6","Matrix 7","Matrix 8","Matrix 9","Matrix 10","Matrix 11","Matrix 12","Lag","Delay Time","Delay Feedb","Delay Send","Rev Decay","Rev Mod","Rev Send","Arp Enable","Arp Latch","Arp Gate","Arp Octaves","Arp Speed"],qs=["Sine","Sine Full","Sine Half","Triangle to Pulse","Triangle to Saw","Triangle to Square","Sawtooth","Supersaw 1","Supersaw 2","Synced Saw","Square to Pulse","Synced Square","FM Sine","FM Triangle","FM Sawtooth","FM Square"],Ht=["Sine","Sine Full","Sine Half","Triangle to Pulse","Triangle to Saw","Triangle to Square","Sawtooth","Supersaw 1","Supersaw 2","Synced Saw","Square to Pulse","Synced Square","Wavetable 1","Wavetable 2","Wavetable 3","Wavetable 4","Wavetable 5","Wavetable 6","Wavetable 7","Wavetable 8"],Qs=["Lowpass 1","Lowpass 2","Lowpass 3","Lowpass 4","Highpass 2","Bandpass 2","Notch","Phaser"],Js=["MM2","Vintage"],Zs=["Off",...bt.slice(1)],Is=["Off","Type 1","Type 2","Type 1+2"],ei=["Clean","Lowpass 1","Lowpass 2","Modulated 1","Modulated 2"],ti=[...bt,"1/16","1/8t","1/8","1/4t","1/8d","1/4"],et=["Sine","Triangle","Sawtooth","Square","S&H Bipolar","Random Bipolar","Attack A","Attack B","Attack C","Decay A","Decay B","Decay C","Attack-Decay A","Attack-Decay B","Attack-Decay C","Square 1 > 0","Square 0 > 1","S&H Unipolar","Random Unipolar"],tt=["Voice","Once","Key","Free"],st=[...bt,"32/1","24/1","16/1","12/1","8/1","6/1","4/1","3/1","2/1","3/2","1/1","2d","1t","1/2","4d","2t","1/4","8d","4t","1/8","16d","8t","1/16","32d","16t","1/32","64d","32t","1/64","64t"],O=["Off","Note","Note+Bend","Velocity","Aftertouch","Mod Wheel","Mod Knob","Pitch Bend","Random 1","Rnd1*Mod","Random 2","Rnd2*Knob","Env1","Env1*Vel","Env2","Env2*Vel","Env3","Env3*Vel","LFO1","LFO1*Vel","LFO1*Aft","LFO1*Wheel","LFO1*Knob","LFO1*Env1","LFO2","LFO2*Vel","LFO2*Aft","LFO2*Wheel","LFO2*Knob","LFO2*Env2","LFO3","LFO3*Vel","LFO3*Aft","LFO3*Wheel","LFO3*Knob","LFO3*Env3","Arp","Arp*Vel","Arp*Aft","Arp*Wheel","Arp*Knob","Lag","Mult 1","Mult 2","Offset"],w=["Off","Pitch","Tune 1","Tune 2","Tune 3","Shape 1","Shape 2","Shape 3","Shapes","Mix 1","Mix 2","Mix 3","Noise","Cutoff","Resonance","Filter FM","Drive","Glide","VCA","Pan","Attack 1","Attack 2","Attack 3","Attacks","Decay 1","Decay 2","Decay 3","Decays","Sustain 1","Sustain 2","Sustain 3","Sustains","Release 1","Release 2","Release 3","Releases","LFO 1","LFO 2","LFO 3","LFOs","Delay Time","Delay Feedb","Delay Level","Reverb Level","Arp Gate"],ce=O.slice(0,41),si=["Up","3 Up","Down","3 Down","Up/Down","Random","As Played"],ii=["1/1","1/2","1/3","1/4","1/6","1/8","1/12","1/16","1/24","1/32"],S=["Auto","Off","Tie","< -1","1st","2nd","3rd","4th","5th","6th","> +1","Chord"],P=["Low","Mid","High","Random"],ai=["Program","Voice"],ri=["Unipolar","Bipolar"],ni=["Modern","Vintage","Mono","Legato"],oi=["1","2","3","6"],li=["Diffused","Balanced"],ci=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],pi=["Ionian (Major)","Dorian","Phrygian","Lydian","Mixolydian","Aeolian (Minor)","Locrian","Melodic Minor","Dorian b2","Lydian #5","Lydian Dominant","Mixolydian b6","Locrian #2","Altered","Harmonic Minor","Locrian nat6","Ionian #5","Dorian #4","Phrygian Dominant","Lydian #2","Super Locrian"],z=["Off","TRIAD 1 3 5","TRI1I 3 5 1(+1)","TRI2I 5 1(+1) 3(+1)","OP153 1 5 3(+1)","OP315 3(-1) 1 5","OP531 5(-1) 3 1(+1)","TRI8 1 3 5 1(+1)","OC158 1 5 1(+1)","PWR 5(-1) 1 5","PWR+ 1 5 1(+1) 5(+1)","OC138 1 3 1(+1)","OCT+3 1(-1) 1 3","SUS2 1 2 5","OSUS2 1 5 2(+1)","SUS4 1 4 5","OSUS4 1 5 4(+1)","SUS27 1 2 5 7","SUS79 1 5 7 2(+1)","SUS47 1 4 5 7","SUS11 1 5 7 4(+1)","6TH 1 3 5 6","6TH1I 3 5 6 1(+1)","6NO5 1 3 6","OP163 1 6 3(+1)","6NO3 1 5 6","SHL69 1 6 2(+1)","69NO5 1 3 6 2(+1)","7TH 1 3 5 7","7TH1I 3 5 7 1(+1)","7TH2I 5 7 1(+1) 3(+1)","7TH3I 7 1(+1) 3(+1) 5(+1)","SHL37 1 3 7","OP317 3(-1) 1 7","SHL57 1 5 7","OP157 1 5 7 3(+1)","OP137 1 3 7 5(+1)","DRP2 1 5 3(+1) 7(+1)","DRP3 1 7 3(+1) 5(+1)","OP371 3(-1) 7(-1) 1 5","A9NO5 1 3 2(+1)","ADD9 1 3 5 2(+1)","9NO5 1 3 7 2(+1)","OP9 1 7 2(+1) 3(+1)","SHL79 1 7 2(+1)","ADD11 1 3 5 4(+1)","11SHL 1 3 7 4(+1)","13SHL 1 3 7 6(+1)","13NO3 1 5 7 6(+1)","R9A 3 5 7 2(+1)","R9B 7(-1) 2 3 5","R13A 3 6 7 2(+1)","R13B 7(-1) 2 3 6","QTAL 1 4 7","QTAL+ 1 4 7 3(+1)","QTAL9 1 4 7 2(+1)","QNTL4 1 5 2(+1) 6(+1)","CL123 1 2 3","CLSTR 1 2 3 4","CL235 1 2 3 5","CL24 1 2 4","CL245 1 2 4 5","CL246 1 2 4 6","OP314 3(-1) 1 4"],di=[{key:"LAY_CATEGORY",nrpn:9,sysEx:16,label:"Category",title:"Category",default:13,values:os},{key:"LAY_POT1_ASSIGN",nrpn:10,sysEx:17,label:"F",title:"F Knob Assignment",default:0,values:K},{key:"LAY_POT2_ASSIGN",nrpn:11,sysEx:18,label:"Q",title:"Q Knob Assignment",default:0,values:K},{key:"LAY_POT3_ASSIGN",nrpn:12,sysEx:19,label:"M",title:"M Knob Assignment",default:0,values:K},{key:"LAY_ENC1_ASSIGN",nrpn:13,sysEx:20,label:"E1",title:"Encoder 1 Assignment",default:0,values:K},{key:"LAY_ENC2_ASSIGN",nrpn:14,sysEx:21,label:"E2",title:"Encoder 2 Assignment",default:0,values:K},{key:"LAY_ENC3_ASSIGN",nrpn:15,sysEx:22,label:"E3",title:"Encoder 3 Assignment",default:0,values:K},{key:"LAY_ENC4_ASSIGN",nrpn:16,sysEx:23,label:"E4",title:"Encoder 4 Assignment",default:0,values:K},{key:"LAY_MASTER_VOLUME",nrpn:17,sysEx:24,label:"Mix",title:"Program Volume",min:40,max:88,offset:64,default:64},{key:"LAY_TEMPO",nrpn:18,sysEx:25,long:!0,label:"Tempo",title:"Program Tempo",min:0,max:255,displayOffset:40,default:80},{key:"VCE_DETUNE",nrpn:19,sysEx:27,label:"Vc Det",title:"Voice Detune",min:0,max:127,default:24},{key:"VCE_DETUNE_OSC",nrpn:20,sysEx:28,label:"Osc Det",title:"Oscillator Detune",min:0,max:127,default:24},{key:"VCE_PAN_SPREAD",nrpn:21,sysEx:29,label:"Spread",title:"Pan Spread",min:0,max:127,default:24},{key:"VCE_GLIDE",nrpn:22,sysEx:30,label:"Glide",title:"Glide Time",min:0,max:127,default:0},{key:"VCE_PBRANGE_DOWN",nrpn:23,sysEx:31,label:"Down",title:"Pitch Bend Down",min:52,max:64,offset:64,default:62},{key:"VCE_PBRANGE_UP",nrpn:24,sysEx:32,label:"Up",title:"Pitch Bend Up",min:0,max:12,default:2},{key:"ENV1_VCA_VEL_SENS",nrpn:25,sysEx:33,label:"Vel",title:"VCA Velocity Sensitivity",min:0,max:127},{key:"ENV2_FLT_VEL_SENS",nrpn:26,sysEx:34,label:"Env Vel",title:"Filter Env Velocity Sensitivity",min:0,max:127},{key:"OSC1_ALGO",nrpn:27,sysEx:35,label:"Algo",title:"Oscillator 1 Algorithm",values:qs,default:6},{key:"OSC1_SHAPE",nrpn:28,sysEx:36,label:"Shape",title:"Oscillator 1 Shape",min:0,max:127,default:0},{key:"OSC1_TUNE",nrpn:29,sysEx:37,label:"Coarse",title:"Oscillator 1 Coarse Tuning",min:40,max:88,offset:64,default:64},{key:"OSC1_FINETUNE",nrpn:30,sysEx:38,label:"Fine",title:"Oscillator 1 Fine Tuning",min:39,max:89,offset:64,default:64},{key:"OSC2_ALGO",nrpn:31,sysEx:39,label:"Algo",title:"Oscillator 2 Algorithm",values:Ht,default:6},{key:"OSC2_SHAPE",nrpn:32,sysEx:40,label:"Shape",title:"Oscillator 2 Shape",min:0,max:127,default:0},{key:"OSC2_TUNE",nrpn:33,sysEx:41,label:"Coarse",title:"Oscillator 2 Coarse Tuning",min:40,max:88,offset:64,default:64},{key:"OSC2_FINETUNE",nrpn:34,sysEx:42,label:"Fine",title:"Oscillator 2 Fine Tuning",min:39,max:89,offset:64,default:64},{key:"OSC3_ALGO",nrpn:35,sysEx:43,label:"Algo",title:"Oscillator 3 Algorithm",values:Ht,default:6},{key:"OSC3_SHAPE",nrpn:36,sysEx:44,label:"Shape",title:"Oscillator 3 Shape",min:0,max:127,default:0},{key:"OSC3_TUNE",nrpn:37,sysEx:45,label:"Coarse",title:"Oscillator 3 Coarse Tuning",min:40,max:88,offset:64,default:64},{key:"OSC3_FINETUNE",nrpn:38,sysEx:46,label:"Fine",title:"Oscillator 3 Fine Tuning",min:39,max:89,offset:64,default:64},{key:"MIX_OSC1",nrpn:39,sysEx:47,label:"Mix",title:"Oscillator 1 Mix",min:0,max:127,default:127},{key:"MIX_OSC2",nrpn:40,sysEx:48,label:"Mix",title:"Oscillator 2 Mix",min:0,max:127,default:0},{key:"MIX_OSC3",nrpn:41,sysEx:49,label:"Mix",title:"Oscillator 3 Mix",min:0,max:127,default:0},{key:"MIX_NOISE",nrpn:42,sysEx:50,label:"Noise",title:"White Noise Mix",min:0,max:127,default:0},{key:"FILTER_FREQ",nrpn:43,sysEx:51,long:!0,label:"Cutoff",title:"Filter Cutoff Frequency",min:0,max:255,default:255},{key:"FILTER_RESO",nrpn:44,sysEx:53,label:"Reso",title:"Filter Resonance",min:0,max:127},{key:"FILTER_ENV2",nrpn:45,sysEx:54,long:!0,label:"Env",title:"Filter Envelope Amount",min:29,max:227,offset:128,default:128},{key:"FILTER_TRACKING",nrpn:46,sysEx:56,label:"Keyb",title:"Filter Keyboard Tracking",min:0,max:100},{key:"FILTER_FM",nrpn:47,sysEx:57,label:"FM",title:"Filter FM Amount from OSC 3",min:0,max:127},{key:"DRIVE_VOICE",nrpn:50,sysEx:60,label:"Drive",title:"Drive (Off: no drive, can't be modulated)",values:Zs,default:0},{key:"ENV1_ATK",nrpn:51,sysEx:61,label:"Attack",title:"Envelope 1 Attack",min:0,max:127,default:0},{key:"ENV1_DCY",nrpn:52,sysEx:62,label:"Decay",title:"Envelope 1 Decay",min:0,max:127,default:0},{key:"ENV1_SUS",nrpn:53,sysEx:63,label:"Sustain",title:"Envelope 1 Sustain",min:0,max:127,default:127},{key:"ENV1_REL",nrpn:54,sysEx:64,label:"Release",title:"Envelope 1 Release",min:0,max:127,default:0},{key:"ENV2_ATK",nrpn:55,sysEx:65,label:"Attack",title:"Envelope 2 Attack",min:0,max:127,default:0},{key:"ENV2_DCY",nrpn:56,sysEx:66,label:"Decay",title:"Envelope 2 Decay",min:0,max:127,default:0},{key:"ENV2_SUS",nrpn:57,sysEx:67,label:"Sustain",title:"Envelope 2 Sustain",min:0,max:127,default:127},{key:"ENV2_REL",nrpn:58,sysEx:68,label:"Release",title:"Envelope 2 Release",min:0,max:127,default:0},{key:"ENV3_ATK",nrpn:59,sysEx:69,label:"Attack",title:"Envelope 3 Attack",min:0,max:127,default:0},{key:"ENV3_DCY",nrpn:60,sysEx:70,label:"Decay",title:"Envelope 3 Decay",min:0,max:127,default:0},{key:"ENV3_SUS",nrpn:61,sysEx:71,label:"Sustain",title:"Envelope 3 Sustain",min:0,max:127,default:127},{key:"ENV3_REL",nrpn:62,sysEx:72,label:"Release",title:"Envelope 3 Release",min:0,max:127,default:0},{key:"LFO1_WAVE",nrpn:63,sysEx:73,label:"Wave",title:"LFO 1 Waveform",values:et},{key:"LFO1_MODE",nrpn:64,sysEx:74,label:"Mode",title:"LFO 1 Trigger Mode",values:tt},{key:"LFO1_SPEED",nrpn:65,sysEx:75,long:!0,label:"Speed",title:"LFO 1 Speed",values:st,default:48},{key:"LFO2_WAVE",nrpn:66,sysEx:77,label:"Wave",title:"LFO 2 Waveform",values:et},{key:"LFO2_MODE",nrpn:67,sysEx:78,label:"Mode",title:"LFO 2 Trigger Mode",values:tt},{key:"LFO2_SPEED",nrpn:68,sysEx:79,long:!0,label:"Speed",title:"LFO 2 Speed",values:st,default:48},{key:"LFO3_WAVE",nrpn:69,sysEx:81,label:"Wave",title:"LFO 3 Waveform",values:et},{key:"LFO3_MODE",nrpn:70,sysEx:82,label:"Mode",title:"LFO 3 Trigger Mode",values:tt},{key:"LFO3_SPEED",nrpn:71,sysEx:83,long:!0,label:"Speed",title:"LFO 3 Speed",values:st,default:48},{key:"MTX1_SRC",nrpn:72,sysEx:85,label:"Source",title:"Matrix 1 Source",values:O},{key:"MTX1_DST",nrpn:73,sysEx:86,label:"Dest",title:"Matrix 1 Destination",values:w},{key:"MTX2_SRC",nrpn:74,sysEx:87,label:"Source",title:"Matrix 2 Source",values:O},{key:"MTX2_DST",nrpn:75,sysEx:88,label:"Dest",title:"Matrix 2 Destination",values:w},{key:"MTX3_SRC",nrpn:76,sysEx:89,label:"Source",title:"Matrix 3 Source",values:O},{key:"MTX3_DST",nrpn:77,sysEx:90,label:"Dest",title:"Matrix 3 Destination",values:w},{key:"MTX4_SRC",nrpn:78,sysEx:91,label:"Source",title:"Matrix 4 Source",values:O},{key:"MTX4_DST",nrpn:79,sysEx:92,label:"Dest",title:"Matrix 4 Destination",values:w},{key:"MTX5_SRC",nrpn:80,sysEx:93,label:"Source",title:"Matrix 5 Source",values:O},{key:"MTX5_DST",nrpn:81,sysEx:94,label:"Dest",title:"Matrix 5 Destination",values:w},{key:"MTX6_SRC",nrpn:82,sysEx:95,label:"Source",title:"Matrix 6 Source",values:O},{key:"MTX6_DST",nrpn:83,sysEx:96,label:"Dest",title:"Matrix 6 Destination",values:w},{key:"MTX7_SRC",nrpn:84,sysEx:97,label:"Source",title:"Matrix 7 Source",values:O},{key:"MTX7_DST",nrpn:85,sysEx:98,label:"Dest",title:"Matrix 7 Destination",values:w},{key:"MTX8_SRC",nrpn:86,sysEx:99,label:"Source",title:"Matrix 8 Source",values:O},{key:"MTX8_DST",nrpn:87,sysEx:100,label:"Dest",title:"Matrix 8 Destination",values:w},{key:"MTX9_SRC",nrpn:88,sysEx:101,label:"Source",title:"Matrix 9 Source",values:O},{key:"MTX9_DST",nrpn:89,sysEx:102,label:"Dest",title:"Matrix 9 Destination",values:w},{key:"MTX10_SRC",nrpn:90,sysEx:103,label:"Source",title:"Matrix 10 Source",values:O},{key:"MTX10_DST",nrpn:91,sysEx:104,label:"Dest",title:"Matrix 10 Destination",values:w},{key:"MTX11_SRC",nrpn:92,sysEx:105,label:"Source",title:"Matrix 11 Source",values:O},{key:"MTX11_DST",nrpn:93,sysEx:106,label:"Dest",title:"Matrix 11 Destination",values:w},{key:"MTX12_SRC",nrpn:94,sysEx:107,label:"Source",title:"Matrix 12 Source",values:O},{key:"MTX12_DST",nrpn:95,sysEx:108,label:"Dest",title:"Matrix 12 Destination",values:w},{key:"MTX1_AMT",nrpn:96,sysEx:109,long:!0,label:"Amount",title:"Matrix 1 Amount",min:29,max:227,offset:128,default:128},{key:"MTX2_AMT",nrpn:97,sysEx:111,long:!0,label:"Amount",title:"Matrix 2 Amount",min:29,max:227,offset:128,default:128},{key:"MTX3_AMT",nrpn:98,sysEx:113,long:!0,label:"Amount",title:"Matrix 3 Amount",min:29,max:227,offset:128,default:128},{key:"MTX4_AMT",nrpn:99,sysEx:115,long:!0,label:"Amount",title:"Matrix 4 Amount",min:29,max:227,offset:128,default:128},{key:"MTX5_AMT",nrpn:100,sysEx:117,long:!0,label:"Amount",title:"Matrix 5 Amount",min:29,max:227,offset:128,default:128},{key:"MTX6_AMT",nrpn:101,sysEx:119,long:!0,label:"Amount",title:"Matrix 6 Amount",min:29,max:227,offset:128,default:128},{key:"MTX7_AMT",nrpn:102,sysEx:121,long:!0,label:"Amount",title:"Matrix 7 Amount",min:29,max:227,offset:128,default:128},{key:"MTX8_AMT",nrpn:103,sysEx:123,long:!0,label:"Amount",title:"Matrix 8 Amount",min:29,max:227,offset:128,default:128},{key:"MTX9_AMT",nrpn:104,sysEx:125,long:!0,label:"Amount",title:"Matrix 9 Amount",min:29,max:227,offset:128,default:128},{key:"MTX10_AMT",nrpn:105,sysEx:127,long:!0,label:"Amount",title:"Matrix 10 Amount",min:29,max:227,offset:128,default:128},{key:"MTX11_AMT",nrpn:106,sysEx:129,long:!0,label:"Amount",title:"Matrix 11 Amount",min:29,max:227,offset:128,default:128},{key:"MTX12_AMT",nrpn:107,sysEx:131,long:!0,label:"Amount",title:"Matrix 12 Amount",min:29,max:227,offset:128,default:128},{key:"MULT_A1",nrpn:108,sysEx:133,label:"Mult 1 Source A",title:"Mult Operator 1 Source A",values:ce},{key:"MULT_B1",nrpn:109,sysEx:134,label:"Mult 1 Source B",title:"Mult Operator 1 Source B",values:ce},{key:"MULT_A2",nrpn:110,sysEx:135,label:"Mult 2 Source A",title:"Mult Operator 2 Source A",values:ce},{key:"MULT_B2",nrpn:111,sysEx:136,label:"Mult 2 Source B",title:"Mult Operator 2 Source B",values:ce},{key:"LAG_SRC1",nrpn:112,sysEx:137,label:"Lag Source",title:"Lag Operator 1 Source",values:ce},{key:"LAG_AMT1",nrpn:113,sysEx:138,label:"Time",title:"Lag Operator 1 Time",min:0,max:127,default:0},{key:"MORPH_KNOB",nrpn:114,sysEx:139,label:"Morph",title:"Morph (Mod) Knob",min:0,max:127,default:0},{key:"DLY_PARAM2",nrpn:115,sysEx:140,label:"Feedb",title:"Delay Feedback",min:0,max:127,default:32},{key:"DLY_PARAM3",nrpn:116,sysEx:141,label:"Send",title:"Delay Send Level",min:0,max:127,default:0},{key:"REV_PARAM1",nrpn:117,sysEx:142,label:"Decay",title:"Reverb Decay Time",min:0,max:127,default:48},{key:"REV_PARAM2",nrpn:118,sysEx:143,label:"Mod",title:"Reverb Modulation Amount",min:0,max:127,default:36},{key:"REV_PARAM3",nrpn:119,sysEx:144,label:"Send",title:"Reverb Send Level",min:0,max:127,default:0},{key:"IFX_EQ",nrpn:120,sysEx:145,long:!0,label:"EQ",title:"EQ Frequency",min:29,max:227,offset:128,default:128},{key:"DLY_PARAM1",nrpn:121,sysEx:147,long:!0,label:"Time",title:"Delay Time",values:ti,default:129},{key:"ARP_TYPE",nrpn:122,sysEx:149,label:"Style",title:"Arpeggiator Style",values:si},{key:"ARP_SPEED",nrpn:123,sysEx:150,label:"Speed",title:"Arpeggiator Speed",values:ii},{key:"ARP_STEPSEQ_DEST",nrpn:124,sysEx:151,label:"Mod Target",title:"Arpeggiator Modulation Target (whole program or triggered voice)",values:ai,default:0},{key:"ARP_STEPSEQ_POLARITY",nrpn:125,sysEx:152,label:"Mod Polarity",title:"Arpeggiator Modulation Polarity",values:ri,default:1},{key:"ARP_GATE",nrpn:126,sysEx:153,label:"Gate",title:"Arpeggiator Gate Length",min:0,max:127,default:64},{key:"VCE_MODE",nrpn:127,sysEx:154,label:"Assign Mode",title:"Voice Assignment Mode",values:ni},{key:"VCE_UNISON",nrpn:128,sysEx:155,label:"Unison",title:"Voice Unison",values:oi},{key:"PAN_MODE",nrpn:129,sysEx:156,label:"Spread",title:"Pan Spread Mode",values:li},{key:"ENV1_RESET",nrpn:130,sysEx:157,label:"Reset to Zero",title:"Envelope 1 Reset",values:F},{key:"ENV2_RESET",nrpn:131,sysEx:158,label:"Reset to Zero",title:"Envelope 2 Reset",values:F},{key:"ENV3_RESET",nrpn:132,sysEx:159,label:"Reset to Zero",title:"Envelope 3 Reset",values:F},{key:"OSC_PHASE_RESET",nrpn:134,sysEx:161,label:"Phase Reset",title:"Oscillator Phase Reset",values:F},{key:"FILTER_ALGO",nrpn:135,sysEx:162,label:"Type",title:"Filter Type",values:Qs},{key:"FILTER_CHARACTER",nrpn:136,sysEx:163,label:"Char",title:"Filter Character",values:Js},{key:"IFX_CHORUS",nrpn:137,sysEx:164,label:"Chorus",title:"Chorus Mode",values:Is},{key:"DLY_TYPE",nrpn:138,sysEx:165,label:"Mode",title:"Delay Mode",values:ei},{key:"ARP_OFF_ON",nrpn:140,sysEx:167,label:"Enable",title:"Enable Arpeggiator",values:F},{key:"ARP_LATCH",nrpn:141,sysEx:168,label:"Latch",title:"Arpeggiator Latch",values:F},{key:"ARP_OCTAVE",nrpn:142,sysEx:169,label:"Octs",title:"Arpeggiator Ocatve Spread",min:0,max:3,displayOffset:1,default:0},{key:"ARP_PTN_LENGTH",nrpn:143,sysEx:170,label:"Length",title:"Arpeggiator Pattern Length",min:0,max:15,displayOffset:1,default:15},{key:"ARP_PTN_STEP01",nrpn:144,sysEx:171,label:"1",title:"Arpeggiator Note Step 1",values:S},{key:"ARP_PTN_STEP02",nrpn:145,sysEx:172,label:"2",title:"Arpeggiator Note Step 2",values:S},{key:"ARP_PTN_STEP03",nrpn:146,sysEx:173,label:"3",title:"Arpeggiator Note Step 3",values:S},{key:"ARP_PTN_STEP04",nrpn:147,sysEx:174,label:"4",title:"Arpeggiator Note Step 4",values:S},{key:"ARP_PTN_STEP05",nrpn:148,sysEx:175,label:"5",title:"Arpeggiator Note Step 5",values:S},{key:"ARP_PTN_STEP06",nrpn:149,sysEx:176,label:"6",title:"Arpeggiator Note Step 6",values:S},{key:"ARP_PTN_STEP07",nrpn:150,sysEx:177,label:"7",title:"Arpeggiator Note Step 7",values:S},{key:"ARP_PTN_STEP08",nrpn:151,sysEx:178,label:"8",title:"Arpeggiator Note Step 8",values:S},{key:"ARP_PTN_STEP09",nrpn:152,sysEx:179,label:"9",title:"Arpeggiator Note Step 9",values:S},{key:"ARP_PTN_STEP10",nrpn:153,sysEx:180,label:"10",title:"Arpeggiator Note Step 10",values:S},{key:"ARP_PTN_STEP11",nrpn:154,sysEx:181,label:"11",title:"Arpeggiator Note Step 11",values:S},{key:"ARP_PTN_STEP12",nrpn:155,sysEx:182,label:"12",title:"Arpeggiator Note Step 12",values:S},{key:"ARP_PTN_STEP13",nrpn:156,sysEx:183,label:"13",title:"Arpeggiator Note Step 13",values:S},{key:"ARP_PTN_STEP14",nrpn:157,sysEx:184,label:"14",title:"Arpeggiator Note Step 14",values:S},{key:"ARP_PTN_STEP15",nrpn:158,sysEx:185,label:"15",title:"Arpeggiator Note Step 15",values:S},{key:"ARP_PTN_STEP16",nrpn:159,sysEx:186,label:"16",title:"Arpeggiator Note Step 16",values:S},{key:"ARP_PTN_STEP_MOD01",nrpn:160,sysEx:187,label:"1",title:"Arpeggiator Modulation Step 1",values:P,default:1},{key:"ARP_PTN_STEP_MOD02",nrpn:161,sysEx:188,label:"2",title:"Arpeggiator Modulation Step 2",values:P,default:1},{key:"ARP_PTN_STEP_MOD03",nrpn:162,sysEx:189,label:"3",title:"Arpeggiator Modulation Step 3",values:P,default:1},{key:"ARP_PTN_STEP_MOD04",nrpn:163,sysEx:190,label:"4",title:"Arpeggiator Modulation Step 4",values:P,default:1},{key:"ARP_PTN_STEP_MOD05",nrpn:164,sysEx:191,label:"5",title:"Arpeggiator Modulation Step 5",values:P,default:1},{key:"ARP_PTN_STEP_MOD06",nrpn:165,sysEx:192,label:"6",title:"Arpeggiator Modulation Step 6",values:P,default:1},{key:"ARP_PTN_STEP_MOD07",nrpn:166,sysEx:193,label:"7",title:"Arpeggiator Modulation Step 7",values:P,default:1},{key:"ARP_PTN_STEP_MOD08",nrpn:167,sysEx:194,label:"8",title:"Arpeggiator Modulation Step 8",values:P,default:1},{key:"ARP_PTN_STEP_MOD09",nrpn:168,sysEx:195,label:"9",title:"Arpeggiator Modulation Step 9",values:P,default:1},{key:"ARP_PTN_STEP_MOD10",nrpn:169,sysEx:196,label:"10",title:"Arpeggiator Modulation Step 10",values:P,default:1},{key:"ARP_PTN_STEP_MOD11",nrpn:170,sysEx:197,label:"11",title:"Arpeggiator Modulation Step 11",values:P,default:1},{key:"ARP_PTN_STEP_MOD12",nrpn:171,sysEx:198,label:"12",title:"Arpeggiator Modulation Step 12",values:P,default:1},{key:"ARP_PTN_STEP_MOD13",nrpn:172,sysEx:199,label:"13",title:"Arpeggiator Modulation Step 13",values:P,default:1},{key:"ARP_PTN_STEP_MOD14",nrpn:173,sysEx:200,label:"14",title:"Arpeggiator Modulation Step 14",values:P,default:1},{key:"ARP_PTN_STEP_MOD15",nrpn:174,sysEx:201,label:"15",title:"Arpeggiator Modulation Step 15",values:P,default:1},{key:"ARP_PTN_STEP_MOD16",nrpn:175,sysEx:202,label:"16",title:"Arpeggiator Modulation Step 16",values:P,default:1},{key:"KBD_MIDI_INPUT",nrpn:176,sysEx:203,label:"MIDI Input",title:"Play Scaler / Chorder via MIDI Input",values:F},{key:"KBD_KEY",nrpn:177,sysEx:204,label:"Key",title:"Scale Root Note",values:ci},{key:"KBD_CHORD_EXPAND",nrpn:178,sysEx:205,label:"Chord Expand",title:"Chord Expand (individual chord per scale degree)",values:F},{key:"KBD_OCTAVE",nrpn:179,sysEx:206,label:"Octave",title:"Keyboard Octave Shift",min:61,max:67,offset:64,default:64},{key:"KBD_SCALE",nrpn:180,sysEx:207,label:"Scale",title:"Keyboard Scale",values:pi},{key:"CHORD_TYPE1",nrpn:181,sysEx:208,label:"Chord 1",title:"Base Chord (Scale Degree 1), Off disables the chorder",values:z},{key:"CHORD_TYPE2",nrpn:182,sysEx:209,label:"Chord 2",title:"Chord for Scale Degree 2 (requires Chord Expand)",values:z},{key:"CHORD_TYPE3",nrpn:183,sysEx:210,label:"Chord 3",title:"Chord for Scale Degree 3 (requires Chord Expand)",values:z},{key:"CHORD_TYPE4",nrpn:184,sysEx:211,label:"Chord 4",title:"Chord for Scale Degree 4 (requires Chord Expand)",values:z},{key:"CHORD_TYPE5",nrpn:185,sysEx:212,label:"Chord 5",title:"Chord for Scale Degree 5 (requires Chord Expand)",values:z},{key:"CHORD_TYPE6",nrpn:186,sysEx:213,label:"Chord 6",title:"Chord for Scale Degree 6 (requires Chord Expand)",values:z},{key:"CHORD_TYPE7",nrpn:187,sysEx:214,label:"Chord 7",title:"Chord for Scale Degree 7 (requires Chord Expand)",values:z}];

return {
    LOOKUPS: {
        categories: os,
        assignTargets: K,
        osc1Algos: qs,
        osc23Algos: Ht,
        filterTypes: Qs,
        filterCharacters: Js,
        chorusTypes: Is,
        delayTypes: ei,
        delayTimes: ti,
        lfoWaves: et,
        lfoModes: tt,
        lfoSpeeds: st,
        modSources: O,
        modDests: w,
        stepSeqDests: ce,
        arpTypes: si,
        arpSpeeds: ii,
        arpStepModes: S,
        arpGates: P,
        oscPhaseModes: ai,
        stepSeqPolarities: ri,
        voiceModes: ni,
        unisonVoices: oi,
        panModes: li,
        notes: ci,
        scales: pi,
        chords: z
    },
    INIT_PROGRAM_BYTES: ue,
    MM2_PARAMETERS: di,
    V2_V3_MAP: zs,
    V3_NEW_PARAMS: js
};
})();

// Map from parameter key to its parameter definition object
const PARAM_MAP = new Map();
const NRPN_TO_PARAM = new Map();
for (const p of MM2_PARAMETERS) {
    PARAM_MAP.set(p.key, p);
    if (p.nrpn !== undefined) {
        NRPN_TO_PARAM.set(p.nrpn, p);
    }
}

// MicroMonsta 2 Standard MIDI Continuous Controller (CC) Map
const MM2_CC_MAP = new Map([
    // Oscillator 1
    [39, { key: 'OSC1_SHAPE' }],
    [40, { key: 'OSC1_TUNE' }],
    [41, { key: 'OSC1_FINETUNE' }],

    // Oscillator 2
    [42, { key: 'OSC2_SHAPE' }],
    [43, { key: 'OSC2_TUNE' }],
    [44, { key: 'OSC2_FINETUNE' }],

    // Oscillator 3
    [45, { key: 'OSC3_SHAPE' }],
    [46, { key: 'OSC3_TUNE' }],
    [47, { key: 'OSC3_FINETUNE' }],

    // Mixer
    [48, { key: 'MIX_OSC1' }],
    [49, { key: 'MIX_OSC2' }],
    [50, { key: 'MIX_OSC3' }],
    [51, { key: 'MIX_NOISE' }],

    // Filter
    [74, { key: 'FILTER_FREQ', scale: 255 / 127 }],
    [71, { key: 'FILTER_RESO' }],
    [88, { key: 'FILTER_ENV2', scale: 255 / 127 }],
    [89, { key: 'FILTER_TRACKING', scale: 100 / 127 }],
    [90, { key: 'FILTER_FM' }],

    // Envelopes
    [73, { key: 'ENV1_ATK' }],
    [75, { key: 'ENV1_DCY' }],
    [79, { key: 'ENV1_SUS' }],
    [72, { key: 'ENV1_REL' }],

    [80, { key: 'ENV2_ATK' }],
    [81, { key: 'ENV2_DCY' }],
    [82, { key: 'ENV2_SUS' }],
    [83, { key: 'ENV2_REL' }],

    [84, { key: 'ENV3_ATK' }],
    [85, { key: 'ENV3_DCY' }],
    [86, { key: 'ENV3_SUS' }],
    [87, { key: 'ENV3_REL' }],

    // LFOs
    [76, { key: 'LFO1_SPEED', scale: 255 / 127 }],
    [77, { key: 'LFO2_SPEED', scale: 255 / 127 }],
    [78, { key: 'LFO3_SPEED', scale: 255 / 127 }],

    // Performance & Voice
    [1,  { key: 'MORPH_KNOB' }],
    [5,  { key: 'VCE_GLIDE' }],
    [7,  { key: 'LAY_MASTER_VOLUME' }],
    [33, { key: 'VCE_DETUNE' }],
    [34, { key: 'VCE_DETUNE_OSC' }],
    [35, { key: 'VCE_PAN_SPREAD' }],
    [36, { key: 'ENV1_VCA_VEL_SENS' }],
    [37, { key: 'ENV2_FLT_VEL_SENS' }],
    [62, { key: 'LAG_AMT1' }],
    [70, { key: 'MORPH_KNOB' }],
    [91, { key: 'DRIVE_VOICE' }],

    // Matrix Amounts (v2.7 manual Section 7.1)
    [52, { key: 'MTX1_AMT', scale: 255 / 127 }],
    [53, { key: 'MTX2_AMT', scale: 255 / 127 }],
    [54, { key: 'MTX3_AMT', scale: 255 / 127 }],
    [55, { key: 'MTX4_AMT', scale: 255 / 127 }],
    [56, { key: 'MTX5_AMT', scale: 255 / 127 }],
    [57, { key: 'MTX6_AMT', scale: 255 / 127 }],
    [58, { key: 'MTX7_AMT', scale: 255 / 127 }],
    [59, { key: 'MTX8_AMT', scale: 255 / 127 }],
    [60, { key: 'MTX9_AMT', scale: 255 / 127 }],
    [61, { key: 'MTX10_AMT', scale: 255 / 127 }],

    // FX
    [25, { key: 'IFX_EQ', scale: 255 / 127 }],
    [26, { key: 'DLY_PARAM1' }],
    [27, { key: 'DLY_PARAM2' }],
    [28, { key: 'DLY_PARAM3' }],
    [29, { key: 'REV_PARAM1' }],
    [30, { key: 'REV_PARAM2' }],
    [31, { key: 'REV_PARAM3' }]
]);

// Firmware v2.x NRPN Map (verified against v2.7+ specification)
const V2_NRPN_MAP = new Map();
const V2_NRPN_TO_PARAM = new Map();
(() => {
    const v2Entries = [];
    // NRPN 9..47 match v3 (LAY_CATEGORY .. FILTER_FM)
    for (const p of MM2_PARAMETERS) {
        if (p.nrpn !== undefined && p.nrpn >= 9 && p.nrpn <= 47) {
            v2Entries.push([p.key, p.nrpn, !!p.long]);
        }
    }
    v2Entries.push(
        ['DRIVE_VOICE', 48, false],
        ['ENV1_ATK', 49, false], ['ENV1_DCY', 50, false], ['ENV1_SUS', 51, false], ['ENV1_REL', 52, false],
        ['ENV2_ATK', 53, false], ['ENV2_DCY', 54, false], ['ENV2_SUS', 55, false], ['ENV2_REL', 56, false],
        ['ENV3_ATK', 57, false], ['ENV3_DCY', 58, false], ['ENV3_SUS', 59, false], ['ENV3_REL', 60, false],
        ['LFO1_WAVE', 61, false], ['LFO1_SPEED', 62, true], ['LFO1_MODE', 63, false],
        ['LFO2_WAVE', 64, false], ['LFO2_SPEED', 65, true], ['LFO2_MODE', 66, false],
        ['LFO3_WAVE', 67, false], ['LFO3_SPEED', 68, true], ['LFO3_MODE', 69, false]
    );
    for (let m = 1; m <= 10; m++) {
        const base = 70 + (m - 1) * 3;
        v2Entries.push(
            [`MTX${m}_SRC`, base, false],
            [`MTX${m}_DST`, base + 1, false],
            [`MTX${m}_AMT`, base + 2, true]
        );
    }
    v2Entries.push(
        ['LAG_SRC1', 100, false], ['LAG_AMT1', 101, false],
        ['MULT_A1', 102, false], ['MULT_B1', 103, false],
        ['MULT_A2', 104, false], ['MULT_B2', 105, false],
        // NRPN 106 unused (MORPH_KNOB uses CC 70 in v2.x)
        ['IFX_EQ', 107, true], ['DLY_PARAM1', 108, true],
        ['DLY_PARAM2', 109, false], ['DLY_PARAM3', 110, false],
        ['REV_PARAM1', 111, false], ['REV_PARAM2', 112, false], ['REV_PARAM3', 113, false],
        ['ARP_TYPE', 114, false], ['ARP_GATE', 115, false], ['ARP_SPEED', 116, false],
        ['VCE_MODE', 117, false], ['VCE_UNISON', 118, false], ['PAN_MODE', 119, false],
        ['ENV1_RESET', 120, false], ['ENV2_RESET', 121, false], ['ENV3_RESET', 122, false],
        // NRPN 123 unused
        ['OSC_PHASE_RESET', 124, false], ['FILTER_ALGO', 125, false],
        ['FILTER_CHARACTER', 126, false], ['IFX_CHORUS', 127, false], ['DLY_TYPE', 128, false],
        // NRPN 129 unused
        ['ARP_OFF_ON', 130, false], ['ARP_LATCH', 131, false],
        ['ARP_OCTAVE', 132, false], ['ARP_PTN_LENGTH', 133, false]
    );
    for (let s = 1; s <= 16; s++) {
        const key = `ARP_PTN_STEP${String(s).padStart(2, '0')}`;
        v2Entries.push([key, 133 + s, false]);
    }
    for (const [key, nrpn, long] of v2Entries) {
        const def = PARAM_MAP.get(key);
        if (!def) continue;
        V2_NRPN_MAP.set(key, { nrpn, long });
        V2_NRPN_TO_PARAM.set(nrpn, def);
    }
})();

const V3_ONLY_PARAMS = new Set([
    'MTX11_SRC', 'MTX11_DST', 'MTX11_AMT',
    'MTX12_SRC', 'MTX12_DST', 'MTX12_AMT',
    'ARP_STEPSEQ_DEST', 'ARP_STEPSEQ_POLARITY',
    'FILTER_CHARACTER',
    'KBD_MIDI_INPUT', 'KBD_KEY', 'KBD_CHORD_EXPAND', 'KBD_OCTAVE', 'KBD_SCALE',
    'CHORD_TYPE1', 'CHORD_TYPE2', 'CHORD_TYPE3', 'CHORD_TYPE4',
    'CHORD_TYPE5', 'CHORD_TYPE6', 'CHORD_TYPE7',
    ...Array.from({ length: 16 }, (_, i) => `ARP_PTN_STEP_MOD${String(i + 1).padStart(2, '0')}`)
]);

const V3_ONLY_ASSIGN_INDICES = new Set([46, 47]); // Matrix 11, Matrix 12
const V3_ONLY_SOURCE_INDICES = new Set([36, 37, 38, 39, 40]); // Arp, Arp*Vel, Arp*Aft, Arp*Wheel, Arp*Knob
const V3_ONLY_DEST_INDICES = new Set([8, 28, 29, 30, 31]); // Shapes, Sustain 1..3, Sustains
