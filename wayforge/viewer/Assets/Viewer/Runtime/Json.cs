/*!
 * \file Json.cs
 * \brief Minimal JSON reader and writer for the viewer
 *
 * JsonUtility cannot read the .wfb format (points are [x, y] arrays, rooms
 * hold lists of points), and a full JSON package adds to the WebGL download.
 * Parse() returns plain objects: Dictionary<string, object>, List<object>,
 * double, string, bool or null. Get*() helpers read fields with defaults.
 * Write() produces compact JSON for the events sent back to the page.
 *
 * Links: used by BuildingData (.wfb), RouteView (route JSON) and ViewerApi
 * (event payloads).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Recursive-descent JSON parser and writer
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Wayforge.Viewer
{
    public static class Json
    {
        // Throws FormatException with the character position on malformed input.
        public static object Parse(string text)
        {
            if (text == null) throw new FormatException("no JSON text");
            int i = 0;
            object value = ReadValue(text, ref i);
            SkipSpace(text, ref i);
            if (i != text.Length) throw new FormatException($"unexpected text at {i}");
            return value;
        }

        // --- field access with defaults -------------------------------------------------------

        static object Field(object o, string key)
            => o is Dictionary<string, object> d && d.TryGetValue(key, out var v) ? v : null;

        public static Dictionary<string, object> Obj(object o, string key) => Field(o, key) as Dictionary<string, object>;
        public static List<object> Arr(object o, string key) => Field(o, key) as List<object>;
        public static string Str(object o, string key, string def = "") => Field(o, key) is string s ? s : def;
        public static float Num(object o, string key, float def = 0f) => Field(o, key) is double d ? (float)d : def;
        public static bool Bool(object o, string key, bool def = false) => Field(o, key) is bool b ? b : def;

        // --- writing --------------------------------------------------------------------------

        // Accepts dictionaries, lists / arrays, strings, numbers, bools and null.
        public static string Write(object value)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value);
            return sb.ToString();
        }

        static void WriteValue(StringBuilder sb, object v)
        {
            switch (v)
            {
                case null: sb.Append("null"); break;
                case string s: WriteString(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case float f: sb.Append(f.ToString("R", CultureInfo.InvariantCulture)); break;
                case double d: sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); break;
                case int n: sb.Append(n.ToString(CultureInfo.InvariantCulture)); break;
                case IDictionary dict:
                    sb.Append('{');
                    bool first = true;
                    foreach (DictionaryEntry e in dict)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteString(sb, e.Key.ToString());
                        sb.Append(':');
                        WriteValue(sb, e.Value);
                    }
                    sb.Append('}');
                    break;
                case IEnumerable list:
                    sb.Append('[');
                    bool firstItem = true;
                    foreach (var item in list)
                    {
                        if (!firstItem) sb.Append(',');
                        firstItem = false;
                        WriteValue(sb, item);
                    }
                    sb.Append(']');
                    break;
                default: WriteString(sb, v.ToString()); break;
            }
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // --- parsing --------------------------------------------------------------------------

        static void SkipSpace(string t, ref int i)
        {
            while (i < t.Length && char.IsWhiteSpace(t[i])) i++;
        }

        static object ReadValue(string t, ref int i)
        {
            SkipSpace(t, ref i);
            if (i >= t.Length) throw new FormatException("unexpected end of JSON");
            char c = t[i];
            if (c == '{') return ReadObject(t, ref i);
            if (c == '[') return ReadArray(t, ref i);
            if (c == '"') return ReadString(t, ref i);
            if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber(t, ref i);
            if (Match(t, ref i, "true")) return true;
            if (Match(t, ref i, "false")) return false;
            if (Match(t, ref i, "null")) return null;
            throw new FormatException($"unexpected '{c}' at {i}");
        }

        static bool Match(string t, ref int i, string word)
        {
            if (string.CompareOrdinal(t, i, word, 0, word.Length) != 0) return false;
            i += word.Length;
            return true;
        }

        static Dictionary<string, object> ReadObject(string t, ref int i)
        {
            var obj = new Dictionary<string, object>();
            i++;                                                   // {
            SkipSpace(t, ref i);
            if (i < t.Length && t[i] == '}') { i++; return obj; }
            while (true)
            {
                SkipSpace(t, ref i);
                if (i >= t.Length || t[i] != '"') throw new FormatException($"expected a key at {i}");
                string key = ReadString(t, ref i);
                SkipSpace(t, ref i);
                if (i >= t.Length || t[i] != ':') throw new FormatException($"expected ':' at {i}");
                i++;
                obj[key] = ReadValue(t, ref i);
                SkipSpace(t, ref i);
                if (i < t.Length && t[i] == ',') { i++; continue; }
                if (i < t.Length && t[i] == '}') { i++; return obj; }
                throw new FormatException($"expected ',' or '}}' at {i}");
            }
        }

        static List<object> ReadArray(string t, ref int i)
        {
            var list = new List<object>();
            i++;                                                   // [
            SkipSpace(t, ref i);
            if (i < t.Length && t[i] == ']') { i++; return list; }
            while (true)
            {
                list.Add(ReadValue(t, ref i));
                SkipSpace(t, ref i);
                if (i < t.Length && t[i] == ',') { i++; continue; }
                if (i < t.Length && t[i] == ']') { i++; return list; }
                throw new FormatException($"expected ',' or ']' at {i}");
            }
        }

        static string ReadString(string t, ref int i)
        {
            var sb = new StringBuilder();
            i++;                                                   // opening quote
            while (i < t.Length)
            {
                char c = t[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= t.Length) break;
                char e = t[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (i + 4 > t.Length) throw new FormatException("bad \\u escape");
                        sb.Append((char)int.Parse(t.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: throw new FormatException($"bad escape '\\{e}' at {i - 1}");
                }
            }
            throw new FormatException("unterminated string");
        }

        static double ReadNumber(string t, ref int i)
        {
            int start = i;
            while (i < t.Length && "+-0123456789.eE".IndexOf(t[i]) >= 0) i++;
            if (!double.TryParse(t.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture, out double d))
                throw new FormatException($"bad number at {start}");
            return d;
        }
    }
}
